import * as fs from 'fs';
import { analyzeAudioEnergy, findEmotionPeaks, analyzeFaceReaction, fusePeakRegions } from './signals';
import { callChatWithFallback, getCandidateModels, parseJsonArray, parseJsonObject } from './llm';
import type {
  TranscriptData, TranscriptSegment, MomentCandidate, ScoredMoment, RankedMoment,
  FusedRegion, TranscriptWindow, SignalPeak, DetectOptions, ProgressCallback,
} from './types';

// ── Snap moment boundaries to Whisper segment edges ────────────────
// Cuts then land on sentence pauses instead of mid-word.
export function snapToSegmentBoundary(moments: MomentCandidate[], segments: TranscriptSegment[], tolerance = 3): MomentCandidate[] {
  if (!Array.isArray(segments) || segments.length === 0) return moments;
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  return moments.map((m) => {
    const out = { ...m };
    // startSec: snap BACKWARD to nearest segment start within tolerance
    let bestStart: number | null = null;
    for (const s of sorted) {
      if (s.start > m.startSec) break;
      if (m.startSec - s.start <= tolerance) bestStart = s.start;
    }
    if (bestStart != null) out.startSec = Math.floor(bestStart);
    // endSec: snap FORWARD to nearest segment end within tolerance
    for (const s of sorted) {
      if (s.start > m.endSec + tolerance) break;
      if (s.end >= m.endSec && s.end - m.endSec <= tolerance) {
        out.endSec = Math.ceil(s.end);
        break;
      }
    }
    return out;
  });
}

// ── Validate, clamp & de-duplicate moments ─────────────────────────
export function sanitizeMoments(moments: MomentCandidate[], videoDurationSec: number, minDuration: number, maxDuration: number): ScoredMoment[] {
  const minD = Math.max(5, Number(minDuration) || 15);
  const maxD = Math.max(minD, Number(maxDuration) || 90);
  const cleaned: ScoredMoment[] = [];
  for (const m of moments || []) {
    let startSec = Math.floor(Number(m.startSec));
    let endSec = Math.ceil(Number(m.endSec));
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) continue;
    startSec = Math.max(0, startSec);
    if (Number.isFinite(videoDurationSec) && videoDurationSec > 0) {
      endSec = Math.min(videoDurationSec, endSec);
    }
    if (endSec - startSec < minD) continue;
    if (endSec - startSec > maxD) endSec = startSec + maxD;
    if (endSec <= startSec) continue;
    cleaned.push({
      title: String(m.title || 'Momen Viral').slice(0, 80),
      startSec,
      endSec,
      duration: endSec - startSec,
      viralityScore: Math.max(0, Math.min(100, Math.round(Number(m.viralityScore) || 0))),
      hook: String(m.hook || ''),
      reason: String(m.reason || ''),
    });
  }
  // Highest score first, suppress heavy overlaps (IoU > 0.5 keeps winner)
  cleaned.sort((a, b) => b.viralityScore - a.viralityScore);
  const kept: ScoredMoment[] = [];
  for (const c of cleaned) {
    const overlaps = kept.some((k) => {
      const inter = Math.max(0, Math.min(c.endSec, k.endSec) - Math.max(c.startSec, k.startSec));
      const union = Math.max(c.endSec, k.endSec) - Math.min(c.startSec, k.startSec);
      return union > 0 && inter / union > 0.5;
    });
    if (!overlaps) kept.push(c);
  }
  kept.sort((a, b) => a.startSec - b.startSec);
  return kept;
}

// ── Split segments into overlapping time windows (chunked recall) ──
export function chunkTranscriptWindows(segments: TranscriptSegment[], windowSpanSec = 480, overlapSec = 30, maxWindows = 10): TranscriptWindow[] {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const totalDur = Math.max(...segments.map((s) => Number(s.end) || 0));
  if (!(totalDur > 0)) return [];
  let step = windowSpanSec - overlapSec;
  const n = Math.min(maxWindows, Math.ceil(totalDur / step));
  step = totalDur / n;
  const windows: TranscriptWindow[] = [];
  for (let i = 0; i < n; i++) {
    const wStart = i * step;
    const wEnd = i === n - 1 ? totalDur : Math.min(totalDur, wStart + windowSpanSec);
    const lines: string[] = [];
    for (const s of segments) {
      const text = (s.text || '').trim();
      if (!text) continue;
      if (s.end >= wStart && s.start <= wEnd) {
        lines.push(`[${Math.floor(Math.max(0, s.start))}s - ${Math.floor(s.end)}s] ${text}`);
      }
    }
    let text = lines.join('\n');
    if (text.length > 4000) text = text.substring(0, 4000) + '\n...';
    if (lines.length > 0) windows.push({ start: Math.floor(wStart), end: Math.floor(wEnd), text });
    if (wEnd >= totalDur) break;
  }
  return windows;
}

// ── PASS 1 prompt builder (region detailing, constrained choice) ──
function buildRegionPrompt(regionText: string, region: FusedRegion, durationRule: string): string {
  const peak = Math.floor(region.center);
  return `Kamu adalah editor YouTube Shorts/TikTok/Reels spesialis konten gaming & horror.
Berikut transkrip di sekitar satu PUNCAK ENERGI (teriakan/jumpscare/ledakan emosi terdeteksi di ~${peak}s, sumber sinyal: ${region.sources.join('+')}).
Tentukan TEPAT 1 momen terbaik dari rentang ini untuk klip vertikal pendek.

Aturan momen:
- ${durationRule}
- Momen HARUS mencakup titik puncak (~${peak}s) di dalamnya.
- Alur tuntas: jangan mulai/berakhir di tengah kalimat penting.
- PENTING: startSec & endSec dalam DETIK ABSOLUT video.

Aturan judul & hook (CONTOH):
- BAGUS: title "Ditungguin Pocong di Apartemen 😱" + hook berupa kalimat asli "Tolong... buka pintunya..."
- JELEK: title "Video Paling Seru Sedunia!!" (generik, tidak didukung isi).
- "quote": 1 kalimat ASLI dari transkrip yang membuktikan momen ini layak (anti-clickbait).
- Bahasa mengikuti bahasa video (video Indonesia → Bahasa Indonesia santai).

Transkrip (rentang ${region.start}s–${region.end}s):
${regionText}

Output HANYA 1 JSON object valid (tanpa markdown backtick atau teks lain):
{"title":"...","startSec":12,"endSec":45,"hook":"...","reason":"...","quote":"..."}`;
}

// ── PASS 1 prompt builder (recall, with few-shot title/hook rules) ──
function buildRecallPrompt(windowText: string, wStart: number, wEnd: number, durationRule: string): string {
  const rangeNote = wEnd > 0
    ? `Potongan transkrip ini mencakup rentang ${wStart}s–${wEnd}s dari video.`
    : 'Berikut transkrip video.';
  return `Kamu adalah editor YouTube Shorts/TikTok/Reels spesialis konten gaming & horror.
Dari transkrip berikut, temukan MAKSIMAL 3 momen paling menarik untuk dijadikan klip vertikal pendek.
${rangeNote}

Aturan momen:
- ${durationRule}
- Hook kuat: detik pertama harus langsung memancing (teriakan, jumpscare, momen lucu, plot twist, pernyataan mengejutkan).
- Alur tuntas: jangan mulai/berakhir di tengah kalimat penting.
- PENTING: startSec & endSec dalam DETIK ABSOLUT video (bukan relatif potongan ini).
- "quote": 1 kalimat ASLI dari transkrip yang membuktikan momen ini layak (anti-clickbait).

Aturan judul & hook (CONTOH):
- BAGUS: title "Ditungguin Pocong di Apartemen 😱" + hook berupa kalimat asli "Tolong... buka pintunya..."
- JELEK: title "Video Paling Seru Sedunia!!" (generik, tidak didukung isi video).
- Bahasa mengikuti bahasa video (video Indonesia → Bahasa Indonesia santai).

Transkrip:
${windowText}

Output HANYA JSON array valid (tanpa markdown backtick atau teks lain):`;
}

async function rankCandidatesGlobally(endpoint: string, headers: Record<string, string>, candidateModels: string[], candidates: MomentCandidate[]): Promise<RankedMoment[]> {
  const lines = candidates.map((c, i) => {
    const s = Math.floor(Number(c.startSec) || 0);
    const e = Math.ceil(Number(c.endSec) || 0);
    const title = String(c.title || '').slice(0, 80);
    const hook = String(c.hook || '').slice(0, 160);
    const reason = String(c.reason || '').slice(0, 200);
    const quote = String(c.quote || '').slice(0, 200);
    return `#${i} | ${s}s–${e}s | ${title} | hook: ${hook} | alasan: ${reason} | kutipan: ${quote}`;
  }).join('\n');

  const prompt = `Kamu adalah kurator konten viral Shorts/TikTok. Nilai SETIAP kandidat momen berikut (semuanya dari video yang sama) dengan rubrik 1–10:
- hook: seberapa kuat detik-detik pertama memancing penonton bertahan.
- completeness: alur tuntas & tidak menggantung.
- emotion: emosi yang ditimbulkan (takut, ngakak, takjub, penasaran).

Kandidat:
${lines}

Output HANYA JSON array valid (tanpa markdown), satu objek per kandidat:
[{"index":0,"hook":8,"completeness":7,"emotion":9}]`;

  try {
    const raw = await callChatWithFallback(endpoint, headers, candidateModels,
      [{ role: 'user', content: prompt }], 0.2, 'Viral rank');
    const scores = parseJsonArray(raw);
    const byIndex = new Map<number, { _hook: number; _completeness: number; _emotion: number }>();
    for (const s of scores) {
      const idx = Number((s as any).index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= candidates.length) continue;
      const clamp10 = (v: unknown) => Math.max(1, Math.min(10, Math.round(Number(v) || 5)));
      const sv = s as any;
      byIndex.set(idx, { _hook: clamp10(sv.hook), _completeness: clamp10(sv.completeness), _emotion: clamp10(sv.emotion) });
    }
    return candidates.map((c, i) => ({ ...c, ...(byIndex.get(i) || { _hook: 7, _completeness: 7, _emotion: 7 }) }));
  } catch (err) {
    console.warn('[AI] Global rank failed, using recall order:', (err as Error).message);
    return candidates.map((c) => ({ ...c, _hook: 7, _completeness: 7, _emotion: 7 }));
  }
}

// ── Detect Viral Highlights via LLM (two-pass: chunked recall + global rank) ──
// options: { audioPath, ffmpegPath, reactionVideoPath } — when audio/video are
// available, candidates ground in real screams/spikes/reactions instead of
// free text search.
export async function detectViralMoments(transcriptData: TranscriptData, apiKey: string, provider = 'groq', durationOption = 'auto', minDuration = 15, maxDuration = 90, onProgress: ProgressCallback | null = null, options: DetectOptions = {}): Promise<ScoredMoment[]> {
  if (!apiKey) throw new Error('API Key belum diisi. Buka menu Settings ⚙️ untuk mengisi API Key.');
  const progress = (percent: number, stage: string) => { try { onProgress?.({ percent, stage }); } catch { /* ignore */ } };

  let durationRule = 'Berdurasi fleksibel & alami antara 15 detik sampai 90 detik. PENTING: Durasi TIDAK HARUS 30 detik! Potong sesuai awal dan akhir konteks cerita/pembicaraan secara utuh agar tidak terpotong canggung (bisa 18s, 28s, 45s, 60s, dsb).';
  if (durationOption === 'short') {
    durationRule = 'Berdurasi SINGKAT antara 15 detik sampai 30 detik (cocok untuk hook kilat & punchline cepat). Jangan dipaksakan persis 30 detik jika 18-25 detik sudah cukup.';
  } else if (durationOption === 'medium') {
    durationRule = 'Berdurasi STANDAR antara 30 detik sampai 60 detik (durasi optimal YouTube Shorts & TikTok). Sesuaikan dengan alur cerita yang tuntas.';
  } else if (durationOption === 'long') {
    durationRule = 'Berdurasi PANJANG antara 60 detik sampai 120 detik (cocok untuk cerita mendalam, tutorial, atau podcast klip).';
  } else if (durationOption === 'custom' && minDuration && maxDuration) {
    durationRule = `Berdurasi antara ${minDuration} detik sampai ${maxDuration} detik sesuai preferensi pengguna.`;
  }

  const { endpoint, headers, candidateModels } = await getCandidateModels(apiKey, provider);
  console.log(`[AI] Trying models:`, candidateModels.slice(0, 3).join(' -> '));

  const segments = Array.isArray(transcriptData.segments) ? transcriptData.segments : [];
  const videoDurationSec = segments.length > 0
    ? Math.max(...segments.map((s) => Number(s.end) || 0))
    : 0;

  // ── PASS 1: acoustic/emotion-grounded regions, fallback to full text scan ──
  const candidates: MomentCandidate[] = [];

  const audioPath = options?.audioPath;
  const ffmpegBin = options?.ffmpegPath || 'ffmpeg';
  // matchMode (VOD turnamen panjang): angkat semua batas skala agar
  // menit-menit akhir ikut teranalisis. Default non-match tidak berubah.
  const matchMode = options?.matchMode === true;
  const peakBudget = matchMode ? 40 : 12;
  const regionBudget = matchMode
    ? Math.max(12, Math.min(30, Number(options?.maxRegions) || 24))
    : 8;
  let regions: FusedRegion[] = [];
  if (segments.length > 0 && videoDurationSec > 0) {
    try {
      progress(8, 'AI membaca gelombang suara (teriakan & jumpscare)...');
      let audioPeaks: SignalPeak[] = [];
      if (audioPath && fs.existsSync(audioPath)) {
        audioPeaks = await analyzeAudioEnergy(audioPath, ffmpegBin, peakBudget);
        console.log(`[AI] Audio peaks: ${audioPeaks.length}`);
      }
      const emotionPeaks = findEmotionPeaks(segments, 10, 30, peakBudget, matchMode);
      console.log(`[AI] Emotion peaks: ${emotionPeaks.length}`);
      let facePeaks: SignalPeak[] = [];
      if (options?.reactionVideoPath) {
        progress(12, 'AI membaca ekspresi streamer...');
        facePeaks = await analyzeFaceReaction(options.reactionVideoPath);
      }
      regions = fusePeakRegions(audioPeaks, emotionPeaks, videoDurationSec, 30, regionBudget, facePeaks);
      console.log(`[AI] Fused regions: ${regions.length}`);
    } catch (err) {
      console.warn('[AI] Signal analysis failed, fallback to text recall:', (err as Error).message);
      regions = [];
    }
  }

  if (regions.length > 0) {
    // Constrained detailing: LLM picks exact bounds + title/hook INSIDE each region
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i];
      progress(Math.round(((i + 1) / regions.length) * 70), `AI membedah momen ${i + 1}/${regions.length}...`);
      const lines: string[] = [];
      for (const s of segments) {
        const text = (s.text || '').trim();
        if (!text) continue;
        if (s.end >= r.start - 15 && s.start <= r.end + 15) {
          lines.push(`[${Math.floor(Math.max(0, s.start))}s - ${Math.floor(s.end)}s] ${text}`);
        }
      }
      let regionText = lines.join('\n');
      if (regionText.length > 3000) regionText = regionText.substring(0, 3000) + '\n...';
      if (!regionText.trim()) continue;
      try {
        const prompt = buildRegionPrompt(regionText, r, durationRule);
        const raw = await callChatWithFallback(endpoint, headers, candidateModels,
          [{ role: 'user', content: prompt }], 0.4, `Viral detail (region ${i + 1}/${regions.length})`);
        candidates.push(parseJsonObject(raw) as MomentCandidate);
      } catch (err) {
        console.warn(`[AI] Region ${i + 1} detailing failed, skipping:`, (err as Error).message);
      }
    }
  }

  if (candidates.length === 0 && regions.length > 0) {
    throw new Error('AI gagal membedah momen dari puncak suara yang terdeteksi.');
  }

  if (candidates.length > 0) {
    console.log(`[AI] Region detailing collected ${candidates.length} candidates.`);
  } else {
    // ── FALLBACK: chunked recall over the FULL transcript ──────────
    // matchMode: cakupan window mengikuti durasi video (480s/window)
    // agar VOD 90-120 menit tidak terpotong di 80 menit.
    const windowBudget = matchMode
      ? Math.max(10, Math.min(20, Math.ceil((videoDurationSec || 0) / 450) + 2))
      : 10;
    const windows = chunkTranscriptWindows(segments, 480, 30, windowBudget);

    if (windows.length === 0) {
      // No segments: legacy single-pass on raw text (still with new prompt + sanitize)
      const rawText = String(transcriptData.text || '').slice(0, 10000);
      if (!rawText.trim()) return [];
      const prompt = buildRecallPrompt(rawText, 0, 0, durationRule);
      const raw = await callChatWithFallback(endpoint, headers, candidateModels,
        [{ role: 'user', content: prompt }], 0.4, 'Viral recall (full text)');
      const arr = parseJsonArray(raw);
      if (Array.isArray(arr)) candidates.push(...(arr as MomentCandidate[]));
    } else {
      for (let i = 0; i < windows.length; i++) {
        const w = windows[i];
        progress(Math.round(((i + 1) / windows.length) * 70), `AI memindai bagian ${i + 1}/${windows.length}...`);
        try {
          const prompt = buildRecallPrompt(w.text, w.start, w.end, durationRule);
          const raw = await callChatWithFallback(endpoint, headers, candidateModels,
            [{ role: 'user', content: prompt }], 0.4, `Viral recall (part ${i + 1}/${windows.length})`);
          const found = parseJsonArray(raw);
          if (Array.isArray(found)) candidates.push(...(found as MomentCandidate[]));
        } catch (err) {
          console.warn(`[AI] Recall window ${i + 1} failed, skipping:`, (err as Error).message);
        }
      }
    }
  }

  if (candidates.length === 0) throw new Error('AI tidak menemukan momen yang layak dari transkrip ini.');
  console.log(`[AI] Recall collected ${candidates.length} candidates.`);

  // ── PASS 2: global ranking with explicit rubric ──────────────────
  const scored = await rankCandidatesGlobally(endpoint, headers, candidateModels, candidates);
  progress(85, 'AI merangking momen terbaik...');

  // Score computed in code (0-100), never invented by the LLM
  const withScores = scored.map((c) => ({
    ...c,
    viralityScore: Math.max(0, Math.min(100, Math.round(((c._hook + c._completeness + c._emotion) / 30) * 100))),
  }));

  // ── Guardrails: snap to sentence edges, clamp, dedupe ────────────
  // matchMode: batas atas naik 30 → 100 untuk VOD turnamen panjang.
  const maxMoments = matchMode
    ? Math.max(1, Math.min(100, Number(options?.maxMoments) || 20))
    : Math.max(1, Math.min(30, Number(options?.maxMoments) || 10));
  const snapped = snapToSegmentBoundary(withScores, segments);
  const final = sanitizeMoments(snapped, videoDurationSec, minDuration, maxDuration).slice(0, maxMoments);
  progress(100, 'Analisis viral selesai!');
  console.log(`[AI] Final moments: ${final.length}`);
  return final;
}
