import * as fs from 'fs';
import * as path from 'path';
import { exec, ExecOptions } from 'child_process';

// ── Shared types ───────────────────────────────────────────────────
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  [key: string]: unknown;
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptData {
  text: string;
  segments: TranscriptSegment[];
  words?: TranscriptWord[];
}

export interface MomentCandidate {
  title?: string;
  startSec: number;
  endSec: number;
  hook?: string;
  reason?: string;
  quote?: string;
  [key: string]: unknown;
}

export interface ScoredMoment extends MomentCandidate {
  duration: number;
  viralityScore: number;
}

export interface RankedMoment extends MomentCandidate {
  _hook: number;
  _completeness: number;
  _emotion: number;
}

export interface SignalPeak {
  time: number;
  energy: number;
  source: string;
  emotion?: string;
}

export interface FusedRegion {
  start: number;
  end: number;
  center: number;
  sources: string[];
}

export interface TranscriptWindow {
  start: number;
  end: number;
  text: string;
}

export interface GameBreak {
  time: number;
  label: string;
  source: string;
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface DetectOptions {
  audioPath?: string;
  ffmpegPath?: string;
  reactionVideoPath?: string | null;
  maxMoments?: number;
  maxRegions?: number;
  matchMode?: boolean;
}

export type ProgressCallback = (p: { percent: number; stage: string }) => void;

interface CmdResult {
  stdout: string;
  stderr: string;
}

function runCmd(cmd: string, options: ExecOptions = {}): Promise<CmdResult> {
  return new Promise((resolve, reject) => {
    exec(cmd, { ...options, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject({ error, stdout, stderr });
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

// Helper to format seconds to ASS timestamp (h:mm:ss.cc)
function formatAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

// ── Dynamically discover active Groq models ──────────────────────────
async function getActiveGroqModels(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (res.ok) {
      const data: any = await res.json();
      const modelIds: string[] = ((data.data || []) as any[]).map((m) => String(m.id));
      console.log('[AI] Active Groq models found:', modelIds.length);
      return modelIds;
    }
  } catch (err) {
    console.warn('[AI] Could not fetch models list from Groq:', (err as Error).message);
  }
  return [];
}

// ── Single File Whisper API Caller with Retry & Fallback Models ─────
async function callWhisperApi(filePath: string, apiKey: string, provider = 'groq', retryCount = 2): Promise<any> {
  const audioBuffer: Buffer = fs.readFileSync(filePath);
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mp3' });

  let endpoint = 'https://api.groq.com/openai/v1/audio/transcriptions';
  let models = ['whisper-large-v3-turbo', 'whisper-large-v3'];
  const headers = { 'Authorization': `Bearer ${apiKey}` };

  if (provider === 'openai') {
    endpoint = 'https://api.openai.com/v1/audio/transcriptions';
    models = ['whisper-1'];
  }

  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    for (const model of models) {
      try {
        const formData = new FormData();
        formData.append('file', blob, 'audio.mp3');
        formData.append('model', model);
        formData.append('response_format', 'verbose_json');
        formData.append('temperature', '0');
        formData.append('timestamp_granularities[]', 'word');
        formData.append('timestamp_granularities[]', 'segment');

        console.log(`[AI] Sending audio (${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB) to ${provider} (${model}) [attempt ${attempt + 1}]...`);
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: formData,
        });

        if (!res.ok) {
          const errText = await res.text();
          console.warn(`[AI] Model ${model} returned error (${res.status}): ${errText}`);
          lastErr = new Error(`Speech AI error (${res.status}): ${errText}`);
          continue;
        }

        const data: any = await res.json();
        console.log(`[AI] ✅ Transcription success with ${model}! (Words: ${data.words?.length || 0})`);
        return data;
      } catch (err) {
        console.warn(`[AI] Fetch attempt ${attempt + 1} with ${model} failed (${(err as Error).message}). Retrying...`);
        lastErr = err;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  throw (lastErr as Error) || new Error('Gagal menghubungi Speech AI setelah beberapa percobaan.');
}

// ── Transcribe Audio via Cloud Speech AI (With Auto Chunking <= 6MB) ──
async function transcribeAudio(audioPath: string, apiKey: string, provider = 'groq', ffmpegPath = 'ffmpeg'): Promise<TranscriptData> {
  if (!apiKey) throw new Error('API Key belum diisi. Buka menu Settings ⚙️ untuk mengisi API Key.');

  const stats = fs.statSync(audioPath);
  const sizeMB = stats.size / (1024 * 1024);

  // If under 6MB, send directly (super fast, prevents ECONNRESET)
  if (sizeMB <= 6) {
    const data = await callWhisperApi(audioPath, apiKey, provider);
    return {
      text: data.text || '',
      segments: data.segments || [],
      words: data.words || [],
    };
  }

  console.log(`[AI] Audio file (${sizeMB.toFixed(2)} MB) is large. Chunking to 8-minute segments...`);
  const tmpDir = path.dirname(audioPath);
  const chunkTemplate = path.join(tmpDir, 'chunk_%03d.mp3');
  const segmentDurationSec = 480; // 8 minutes per chunk (~1.5 MB each)

  const splitCmd = `"${ffmpegPath}" -y -i "${audioPath}" -f segment -segment_time ${segmentDurationSec} -c:a libmp3lame -b:a 24k -ar 16000 -ac 1 "${chunkTemplate}"`;
  await runCmd(splitCmd);

  const chunkFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith('chunk_') && f.endsWith('.mp3')).sort();
  console.log(`[AI] Splitted into ${chunkFiles.length} chunks. Transcribing chunks sequentially...`);

  let fullText = '';
  const allSegments: TranscriptSegment[] = [];
  const allWords: TranscriptWord[] = [];

  for (let i = 0; i < chunkFiles.length; i++) {
    const chunkFile = path.join(tmpDir, chunkFiles[i]);
    const offsetSec = i * segmentDurationSec;
    console.log(`[AI] Transcribing chunk ${i + 1}/${chunkFiles.length} (Time offset: ${offsetSec}s)...`);

    const chunkData = await callWhisperApi(chunkFile, apiKey, provider);
    if (chunkData.text) {
      fullText += (fullText ? ' ' : '') + chunkData.text.trim();
    }
    if (chunkData.segments && Array.isArray(chunkData.segments)) {
      for (const seg of chunkData.segments) {
        allSegments.push({
          ...seg,
          start: seg.start + offsetSec,
          end: seg.end + offsetSec,
        });
      }
    }
    if (chunkData.words && Array.isArray(chunkData.words)) {
      for (const w of chunkData.words) {
        allWords.push({
          word: w.word,
          start: w.start + offsetSec,
          end: w.end + offsetSec,
        });
      }
    }
    if (fs.existsSync(chunkFile)) fs.unlinkSync(chunkFile);
  }

  return { text: fullText, segments: allSegments, words: allWords };
}

// ── Robust JSON-array extraction from LLM output ───────────────────
function parseJsonArray(rawContent: string): any[] {
  const cleaned = String(rawContent || '').replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fall through to bracket-match */ }
  const match = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (match) return JSON.parse(match[0]);
  throw new Error('Gagal memproses rekomendasi momen viral dari AI.');
}

// ── Snap moment boundaries to Whisper segment edges ────────────────
// Cuts then land on sentence pauses instead of mid-word.
function snapToSegmentBoundary(moments: MomentCandidate[], segments: TranscriptSegment[], tolerance = 3): MomentCandidate[] {
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
function sanitizeMoments(moments: MomentCandidate[], videoDurationSec: number, minDuration: number, maxDuration: number): ScoredMoment[] {
  const minD = Math.max(5, Number(minDuration) || 15);
  const maxD = Math.max(minD, Number(maxDuration) || 90);
  const cleaned = [];
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
function chunkTranscriptWindows(segments: TranscriptSegment[], windowSpanSec = 480, overlapSec = 30, maxWindows = 10): TranscriptWindow[] {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const totalDur = Math.max(...segments.map((s) => Number(s.end) || 0));
  if (!(totalDur > 0)) return [];
  let step = windowSpanSec - overlapSec;
  const n = Math.min(maxWindows, Math.ceil(totalDur / step));
  step = totalDur / n;
  const windows = [];
  for (let i = 0; i < n; i++) {
    const wStart = i * step;
    const wEnd = i === n - 1 ? totalDur : Math.min(totalDur, wStart + windowSpanSec);
    const lines = [];
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

// ── Audio energy analysis (scream / jumpscare / laughter spikes) ───
// Runs ffmpeg ebur128 once over the already-downloaded audio and parses
// momentary loudness (M) over time. Deterministic, no AI cost.
async function analyzeAudioEnergy(audioPath: string, ffmpegPath = 'ffmpeg', maxPeaks = 12): Promise<SignalPeak[]> {
  const cmd = `"${ffmpegPath}" -hide_banner -v verbose -nostats -i "${audioPath}" -map 0:a:0 -af ebur128 -f null -`;
  let stderr = '';
  try {
    const out = await runCmd(cmd);
    stderr = out.stderr || '';
  } catch (e: any) {
    stderr = (e && e.stderr) || '';
  }
  const text = String(stderr).replace(/\x1b\[[0-9;]*m/g, '');
  const perSec = new Map<number, number>(); // sec -> max momentary loudness
  const re = /t:\s*([\d.]+)\s+.*?M:\s*(-?[\d.]+|-\s*inf)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const t = parseFloat(m[1]);
    const loud = /inf/.test(m[2]) ? -70 : parseFloat(m[2]);
    if (!Number.isFinite(t) || !Number.isFinite(loud)) continue;
    const sec = Math.floor(t);
    if (loud > (perSec.get(sec) ?? -70)) perSec.set(sec, loud);
  }
  const secs = [...perSec.keys()].sort((a, b) => a - b);
  if (secs.length === 0) return [];
  const vals = secs.map((s) => perSec.get(s) as number).sort((a, b) => a - b);
  const baseline = vals[Math.floor(vals.length / 2)];
  const floor = Math.max(baseline ?? -70, -40);
  const peaks: { time: number; energy: number }[] = [];
  const minDist = 20;
  const threshold = 6; // LU above floor
  for (const s of secs) {
    const v = perSec.get(s) ?? -70;
    if (v < floor + threshold) continue;
    const last = peaks[peaks.length - 1];
    if (last && s - last.time < minDist) {
      if (v > last.energy) { last.time = s; last.energy = v; }
      continue;
    }
    peaks.push({ time: s, energy: v });
  }
  peaks.sort((a, b) => b.energy - a.energy);
  return peaks.slice(0, maxPeaks).map((p) => ({ ...p, source: 'audio' }));
}

// ── Transcript emotion spikes (screams/laughter/exclamations in text) ──
const EMOTION_LEXICON = ['astaga', 'astagfirullah', 'anjir', 'anjrit', 'anjay', 'gila', 'sial', 'kampret', 'tolong', 'takut', 'kaget', 'jumpscare', 'serem', 'hantu', 'pocong', 'setan', 'kuntilanak', 'ya ampun', 'yaampun', 'waduh', 'walah', 'edan', 'wow', 'woy', 'buset', 'buseet', 'sumpah', 'parah', 'ngakak', 'lucu', 'amit', 'kaber', 'kabur', 'lari'];
const LAUGH_RE = /(ha){2,}|(hi){2,}|(he){2,}|wkwk+|hihi+|haha+|hehe+|lol+/i;
const ELONG_RE = /([a-z])\1{2,}/i;
// ── MLBB / turnamen war lexicon (kill feed, objective, hype caster ID/EN) ──
// Dipakai dengan bobot ekstra saat matchMode aktif (VOD turnamen panjang).
const WAR_LEXICON = ['savage', 'maniac', 'wipeout', 'wipe out', 'wiped', 'lord', 'turtle', 'first blood', 'double kill', 'triple kill', 'slain', 'slay', 'kill', 'rampage', 'legendary', 'unstoppable', 'shutdown', 'clutch', 'comeback', 'epic', 'victory', 'defeat', 'menang', 'kalah', 'ulti', 'ultimate', 'retri', 'retribution', 'gank', 'push', 'turret', 'inhibitor', 'draft', 'pick', 'banning', 'game point', 'match point', 'best of', 'grand final', 'upper bracket', 'lower bracket'];

function scoreSegmentEmotion(text: string, warBoost = false): number {
  const t = String(text || '');
  if (!t.trim()) return 0;
  let score = 0;
  const lower = t.toLowerCase();
  for (const w of EMOTION_LEXICON) { if (lower.includes(w)) score += 2; }
  if (warBoost) {
    for (const w of WAR_LEXICON) { if (lower.includes(w)) score += 2.5; }
  }
  if (LAUGH_RE.test(t)) score += 2;
  if (ELONG_RE.test(t)) score += 1.5;
  score += Math.min(2, (t.match(/[A-Z]{3,}/g) || []).length * 0.5);
  score += Math.min(2, ((t.match(/!/g) || []).length) * 0.7);
  return score;
}

function findEmotionPeaks(segments: TranscriptSegment[], windowSec = 10, minDist = 30, maxPeaks = 12, warBoost = false): SignalPeak[] {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const totalDur = Math.max(...segments.map((s) => Number(s.end) || 0));
  if (!(totalDur > 0)) return [];
  const wins: { time: number; energy: number }[] = [];
  for (let w = 0; w < totalDur; w += windowSec) {
    let sc = 0;
    for (const s of segments) {
      if (s.end >= w && s.start <= w + windowSec) sc += scoreSegmentEmotion(s.text, warBoost);
    }
    if (sc >= 3) wins.push({ time: w + windowSec / 2, energy: sc });
  }
  wins.sort((a, b) => b.energy - a.energy);
  const peaks: SignalPeak[] = [];
  for (const w of wins) {
    if (peaks.some((p) => Math.abs(p.time - w.time) < minDist)) continue;
    peaks.push({ ...w, source: 'text' });
    if (peaks.length >= maxPeaks) break;
  }
  return peaks;
}

// ── Fuse audio + text + face peaks into candidate regions ───────
// Energies are normalized per source (LUFS vs counts vs 0-100 are
// incomparable raw) so no single signal always wins.
function fusePeakRegions(audioPeaks: SignalPeak[], emotionPeaks: SignalPeak[], videoDurationSec: number, halfWidth = 30, maxRegions = 12, facePeaks: SignalPeak[] = []): FusedRegion[] {
  const norm = (peaks: SignalPeak[]): SignalPeak[] => {
    const arr = Array.isArray(peaks) ? peaks : [];
    const max = Math.max(0.001, ...arr.map((p) => Number(p.energy) || 0));
    return arr.map((p) => ({ ...p, energy: (Number(p.energy) || 0) / max }));
  };
  const all = [...norm(audioPeaks), ...norm(emotionPeaks), ...norm(facePeaks)].sort((a, b) => a.time - b.time);
  const merged: { center: number; energy: number; sources: string[] }[] = [];
  for (const p of all) {
    const last = merged[merged.length - 1];
    if (last && p.time - last.center <= 25) {
      last.center = (last.center + p.time) / 2;
      last.energy = Math.max(last.energy, p.energy);
      if (!last.sources.includes(p.source)) last.sources.push(p.source);
    } else {
      merged.push({ center: p.time, energy: p.energy, sources: [p.source] });
    }
  }
  merged.sort((a, b) => b.energy - a.energy);
  return merged.slice(0, maxRegions).map((r) => ({
    start: Math.max(0, Math.floor(r.center - halfWidth)),
    end: Math.min(videoDurationSec, Math.ceil(r.center + halfWidth)),
    center: r.center,
    sources: r.sources,
  })).filter((r) => r.end - r.start >= 20)
    .sort((a, b) => a.start - b.start);
}

// ── Single JSON-object extraction (region detailing returns 1 object) ──
function parseJsonObject(rawContent: string): any {
  try {
    const arr = parseJsonArray(rawContent);
    const obj = Array.isArray(arr) ? arr[0] : arr;
    if (obj && typeof obj === 'object') return obj;
  } catch { /* try bare object */ }
  const m = String(rawContent || '').match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error('Gagal memproses momen dari AI.');
}

// ── Single chat-completion call with model fallback ────────────────
async function callChatWithFallback(endpoint: string, headers: Record<string, string>, candidateModels: string[], messages: ChatMessage[], temperature: number, label: string): Promise<string> {
  let lastError: unknown = null;
  for (const model of candidateModels) {
    try {
      console.log(`[AI] ${label} with (${model})...`);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages, temperature }),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[AI] Model ${model} returned ${res.status}: ${String(errText).slice(0, 200)}`);
        lastError = new Error(`AI LLM error (${res.status}): ${String(errText).slice(0, 300)}`);
        continue;
      }
      const jsonRes: any = await res.json();
      const content = jsonRes.choices?.[0]?.message?.content?.trim();
      if (content) {
        console.log(`[AI] ✅ ${label} success with ${model}!`);
        return content;
      }
    } catch (err) {
      lastError = err;
    }
  }
  throw (lastError as Error) || new Error('Gagal menghubungi model AI LLM.');
}

// ── Shared Groq/OpenAI model discovery ─────────────────────────────
async function getCandidateModels(apiKey: string, provider = 'groq'): Promise<{ endpoint: string; headers: Record<string, string>; candidateModels: string[] }> {
  const endpoint = provider === 'openai'
    ? 'https://api.openai.com/v1/chat/completions'
    : 'https://api.groq.com/openai/v1/chat/completions';
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
  let candidateModels: string[] = [];
  if (provider === 'openai') {
    candidateModels = ['gpt-4o-mini', 'gpt-4o'];
  } else {
    const activeModels = await getActiveGroqModels(apiKey);
    const preferredPriority = [
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'groq/compound',
      'groq/compound-mini',
      'qwen/qwen3.8-27b',
      'qwen/qwen3.6-27b',
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
    ];
    for (const p of preferredPriority) {
      if (activeModels.includes(p)) candidateModels.push(p);
    }
    activeModels.forEach((m) => {
      if (!candidateModels.includes(m) && !m.includes('whisper') && !m.includes('guard')) {
        candidateModels.push(m);
      }
    });
    if (candidateModels.length === 0) {
      candidateModels = ['openai/gpt-oss-120b', 'groq/compound', 'qwen/qwen3.8-27b'];
    }
  }
  return { endpoint, headers, candidateModels };
}

// ── Streamer facial-reaction peaks via analyze_reaction.py ──────
// Returns [{ time, energy, source: 'face' }]. Empty on any failure
// (no faces, missing video, python error) — caller falls back.
async function analyzeFaceReaction(reactionVideoPath: string | null): Promise<SignalPeak[]> {
  if (!reactionVideoPath || !fs.existsSync(reactionVideoPath)) return [];
  // NOTE: dikompilasi ke dist/ → script python ada di server/
  const script = path.join(__dirname, '..', 'analyze_reaction.py');
  if (!fs.existsSync(script)) return [];
  try {
    const { stdout } = await runCmd(`python "${script}" "${reactionVideoPath}"`);
    const lines = String(stdout || '').trim().split(/[\r\n]+/).filter(Boolean);
    const data = JSON.parse(lines[lines.length - 1]);
    const peaks = Array.isArray(data.peaks) ? data.peaks : [];
    console.log(`[AI] Face peaks: ${peaks.length} (frames: ${data.frames || 0}, faces: ${data.faces || 0}, fer: ${!!data.fer}, blend: ${!!data.blend})`);
    return peaks
      .filter((p: any) => Number.isFinite(Number(p.time)))
      .map((p: any) => ({ time: Math.floor(Number(p.time)), energy: Math.max(0, Number(p.score) || 0), source: 'face', emotion: p.emotion || 'neutral' }));
  } catch (err) {
    console.warn('[AI] Face reaction analysis failed, continuing without it:', (err as Error).message);
    return [];
  }
}

// ── Detect Viral Highlights via LLM (two-pass: chunked recall + global rank) ──
// options: { audioPath, ffmpegPath, reactionVideoPath } — when audio/video are
// available, candidates ground in real screams/spikes/reactions instead of
// free text search.
async function detectViralMoments(transcriptData: TranscriptData, apiKey: string, provider = 'groq', durationOption = 'auto', minDuration = 15, maxDuration = 90, onProgress: ProgressCallback | null = null, options: DetectOptions = {}): Promise<ScoredMoment[]> {
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
      const lines = [];
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

Output HANYA JSON array valid (tanpa markdown backtick atau teks lain):
[{"title":"...","startSec":12,"endSec":45,"hook":"...","reason":"...","quote":"..."}]
Jika tidak ada momen yang layak, output [].`;
}

// ── PASS 2: score every candidate 1-10 per rubric dimension ────────
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

// ── Generate ASS Subtitle with TikTok / Shorts Style (Word-Level Timing) ──
function generateAssSubtitle(transcriptInput: unknown, startSec = 0, endSec = 0, is1080p = true, captionPos = 'middle'): string {
  const playResX = is1080p ? 1080 : 720;
  const playResY = is1080p ? 1920 : 1280;
  const fontSize = is1080p ? 70 : 46;
  const outlineWidth = is1080p ? 6 : 4;

  // Vertical margin from bottom edge (Alignment 2 = bottom-center)
  // Raised significantly so it does not cover the person/streamer or get covered by Shorts/TikTok UI
  let marginV: number;
  if (captionPos === 'top') {
    marginV = is1080p ? 1320 : 880; // Upper third
  } else if (captionPos === 'bottom') {
    marginV = is1080p ? 560 : 375; // Lower zone, safely above UI buttons
  } else {
    // Default 'middle' (Centered in safe zone): y ≈ 1070/1920
    // Perfectly positioned above streamer facecam / torso and below face!
    marginV = is1080p ? 850 : 565;
  }

  let assHeader = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: TikTok,Arial,${fontSize},&H0000FFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${outlineWidth},2,2,40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events: string[] = [];

  // Parse words & segments from transcriptInput
  let words: TranscriptWord[] = [];
  let segments: TranscriptSegment[] = [];

  if (transcriptInput && typeof transcriptInput === 'object') {
    const input = transcriptInput as { words?: unknown; segments?: unknown };
    if (Array.isArray(input.words)) words = input.words as TranscriptWord[];
    if (Array.isArray(input.segments)) segments = input.segments as TranscriptSegment[];
    if (Array.isArray(transcriptInput)) {
      if (transcriptInput.length > 0 && (transcriptInput[0] as any).word !== undefined) {
        words = transcriptInput as TranscriptWord[];
      } else {
        segments = transcriptInput as TranscriptSegment[];
      }
    }
  }

  // 1️⃣ Priority: Millisecond-Accurate Word Timestamps
  if (words && words.length > 0) {
    // If words are in absolute video time (> startSec), offset them
    const validWords = words
      .map(w => {
        let s = w.start;
        let e = w.end;
        if (startSec > 0 && s >= startSec - 1) {
          s = Math.max(0, s - startSec);
          e = Math.max(0, e - startSec);
        }
        return {
          word: (w.word || '').trim(),
          start: s,
          end: e,
        };
      })
      .filter(w => w.word.length > 0 && w.end > w.start);

    // Group into short, punchy 2-3 word chunks based on speech pacing
    const chunks: TranscriptWord[][] = [];
    let currentChunk: TranscriptWord[] = [];

    for (let i = 0; i < validWords.length; i++) {
      const w = validWords[i];
      const prev = currentChunk[currentChunk.length - 1];

      // Break chunk if:
      // - Already 3 words
      // - Or character count >= 18
      // - Or pause between words > 0.32s (speaker paused/took breath)
      // - Or previous word ends with punctuation (. ? ! ,)
      const charCount = currentChunk.reduce((acc, x) => acc + x.word.length, 0);
      const isPause = prev && (w.start - prev.end > 0.32);
      const isPunctuation = prev && /[.?!,]$/.test(prev.word);

      if (currentChunk.length >= 3 || charCount >= 18 || isPause || isPunctuation) {
        if (currentChunk.length > 0) chunks.push(currentChunk);
        currentChunk = [w];
      } else {
        currentChunk.push(w);
      }
    }
    if (currentChunk.length > 0) chunks.push(currentChunk);

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const nextC = chunks[i + 1];

      const cStart = c[0].start;
      const rawEnd = c[c.length - 1].end;
      let cEnd = rawEnd;

      if (nextC) {
        const nextStart = nextC[0].start;
        if (nextStart > rawEnd) {
          const gap = nextStart - rawEnd;
          if (gap < 0.25) {
            // Short gap between syllables/words: bridge smoothly without overlap
            cEnd = nextStart - 0.01;
          } else {
            // Speaker paused: hold for 0.15s then disappear during silence!
            cEnd = Math.min(rawEnd + 0.15, nextStart - 0.05);
          }
        } else {
          // Words are immediately back-to-back
          cEnd = nextStart;
        }
      } else {
        // Last chunk: hold for 0.25s then disappear
        cEnd = rawEnd + 0.25;
      }

      // Safety check: end must be strictly greater than start
      if (cEnd <= cStart) cEnd = cStart + 0.2;

      const text = c.map(x => x.word.toUpperCase()).join(' ');
      events.push(`Dialogue: 0,${formatAssTime(cStart)},${formatAssTime(cEnd)},TikTok,,0,0,0,,${text}`);
    }
  } else if (segments && segments.length > 0) {
    // 2️⃣ Fallback: Segment-based with proportional pacing
    const relevant = segments.filter(s => s.end >= startSec && s.start <= (endSec || Infinity));
    for (const seg of relevant) {
      const segStart = Math.max(0, seg.start - startSec);
      const segEnd = Math.min((endSec || seg.end) - startSec, seg.end - startSec);
      if (segEnd <= segStart) continue;

      const wordsInSeg = (seg.text || '').trim().split(/\s+/).filter(Boolean);
      if (wordsInSeg.length === 0) continue;

      const chunkSize = 3;
      const totalWords = wordsInSeg.length;
      const numChunks = Math.ceil(totalWords / chunkSize);
      const totalDuration = segEnd - segStart;
      const chunkDuration = totalDuration / numChunks;

      for (let i = 0; i < numChunks; i++) {
        const chunkWords = wordsInSeg.slice(i * chunkSize, (i + 1) * chunkSize).join(' ').toUpperCase();
        const cStart = segStart + (i * chunkDuration);
        const cEnd = Math.min(segEnd, cStart + chunkDuration);

        events.push(`Dialogue: 0,${formatAssTime(cStart)},${formatAssTime(cEnd)},TikTok,,0,0,0,,${chunkWords}`);
      }
    }
  }

  return assHeader + events.join('\n') + '\n';
}

// ── Generate AI Social Caption, Title, & Hashtags ─────────────────────
async function generateSocialCaption(clipTitle: string, transcriptText: string, platform = 'youtube', apiKey?: string, provider = 'groq', channelName = ''): Promise<{ title: string; description: string; hashtags: string[]; fullCaption: string }> {
  if (!apiKey) throw new Error('API Key belum diisi. Buka menu Settings ⚙️.');

  const platformName = platform === 'tiktok' ? 'TikTok' : platform === 'instagram' ? 'Instagram Reels' : 'YouTube Shorts';
  const tagRule = platform === 'youtube' ? 'Wajib sertakan #Shorts di akhir judul dan di daftar hashtag.' : 'Gunakan hashtag viral TikTok/Reels.';

  let channelTag = '';
  if (channelName) {
    const cleanTag = channelName.trim().replace(/\s+/g, '').replace(/[^a-zA-Z0-9_]/g, '');
    if (cleanTag) channelTag = `#${cleanTag}`;
  }

  const prompt = `Kamu adalah pakar social media marketing & viral content creator spesialis ${platformName}.
Tugasmu adalah menganalisis transkrip percakapan klip video berikut, lalu membuat Judul Hook Viral, Deskripsi Kontekstual yang menceritakan isi video, serta Hashtag Relevan termasuk nama channel.

Nama Channel / Kreator: ${channelName || '(Tidak spesifik)'}
Judul Klip Saat Ini: "${clipTitle || 'Video Pendek'}"
Transkrip Percakapan Klip:
"""
${(transcriptText || '').slice(0, 2500) || '(Tidak ada transkrip, buat sinopsis berdasarkan judul klip)'}
"""

ATURAN PEMBUATAN:
1. "title":
   - Buat judul baru yang SANGAT MENARIK, PENUH RASA PENASARAN (curiosity hook), dramatis, atau lucu sesuai kejadian di video.
   - Sertakan emoji relevan (😱, 🔥, 🤣, 💀, 🤯, dsb).
   - Maksimal 85 karakter. ${tagRule}

2. "description":
   - JANGAN gunakan template kaku atau kalimat kosong basa-basi!
   - Jelaskan DENGAN MENARIK APA YANG SEBENARNYA TERJADI di video ini berdasarkan percakapan/aksi dalam transkrip (sinopsis cerita momen ini).
   - Buat penonton penasaran dan ingin menonton sampai tuntas.
   - Tambahkan pertanyaan atau ajakan interaksi yang memancing penonton berkomentar.
   - Tambahkan kalimat penutup ajakan like dan subscribe ${channelName ? `ke channel ${channelName}` : 'ke channel ini'}.

3. "hashtags":
   - Array string hashtag (diawali tanda #).
   - WAJIB masukkan hashtag nama channel kreator: ${channelTag ? `"${channelTag}"` : 'nama channel kreator'}.
   - Masukkan 2-3 hashtag topik/genre spesifik dari isi video (contoh: #Gaming, #Horor, #Lucu, #Reaction, #MomenLucu, dsb).
   - Masukkan hashtag trending platform: ${platform === 'youtube' ? '["#Shorts", "#YouTubeShorts", "#Viral", "#FYP", "#Trending"]' : '["#Viral", "#FYP", "#Trending"]'}.
   - Total 6 sampai 9 hashtag.

4. Bahasa: Gunakan Bahasa Indonesia yang luwes, santai, dan sangat memikat penonton media sosial.

Output HANYA format JSON valid tanpa markdown backtick:
{
  "title": "...",
  "description": "...",
  "hashtags": [${channelTag ? `"${channelTag}", ` : ''}"#Shorts", "#FYP", "..."]
}`;

  const endpoint = provider === 'openai'
    ? 'https://api.openai.com/v1/chat/completions'
    : 'https://api.groq.com/openai/v1/chat/completions';

  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };

  let candidateModels: string[] = [];
  if (provider === 'openai') {
    candidateModels = ['gpt-4o-mini', 'gpt-4o'];
  } else {
    const activeModels = await getActiveGroqModels(apiKey);
    const preferredPriority = [
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'groq/compound',
      'groq/compound-mini',
      'qwen/qwen3.8-27b',
      'qwen/qwen3.6-27b',
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
    ];

    for (const p of preferredPriority) {
      if (activeModels.includes(p)) candidateModels.push(p);
    }

    activeModels.forEach(m => {
      if (!candidateModels.includes(m) && !m.includes('whisper') && !m.includes('guard')) {
        candidateModels.push(m);
      }
    });

    if (candidateModels.length === 0) {
      candidateModels = ['openai/gpt-oss-120b', 'groq/compound', 'qwen/qwen3.8-27b'];
    }
  }

  let rawContent: string | null = null;
  let lastErr: unknown = null;

  for (const model of candidateModels) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
        }),
      });
      if (!res.ok) {
        lastErr = new Error(`LLM error (${res.status}): ${await res.text()}`);
        continue;
      }
      const data: any = await res.json();
      rawContent = data.choices?.[0]?.message?.content?.trim();
      if (rawContent) break;
    } catch (e) {
      lastErr = e;
    }
  }

  if (!rawContent) throw (lastErr as Error) || new Error('Gagal menghubungi AI untuk membuat caption.');

  const cleaned = rawContent.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed: any = JSON.parse(cleaned);
    const tags = Array.isArray(parsed.hashtags) ? parsed.hashtags : ['#Shorts', '#FYP', '#Viral'];
    const formattedTags = tags.map((t: any) => (typeof t === 'string' && t.startsWith('#')) ? t : `#${t}`);
    return {
      title: parsed.title || clipTitle,
      description: parsed.description || '',
      hashtags: formattedTags,
      fullCaption: `${parsed.description || ''}\n\n${formattedTags.join(' ')}`.trim(),
    };
  } catch {
    return {
      title: `${clipTitle} #Shorts`,
      description: `Tonton momen seru ini! Jangan lupa like dan subscribe untuk video seru lainnya!`,
      hashtags: ['#Shorts', '#Viral', '#FYP', '#Trending'],
      fullCaption: `Tonton momen seru ini! Jangan lupa like dan subscribe!\n\n#Shorts #Viral #FYP #Trending`,
    };
  }
}

// ── Game-break detection untuk VOD turnamen (pecah per game) ──────
// Heuristik murah tanpa CV: keyword batas game di transkrip + jeda sunyi
// panjang di audio (draft pick / jeda antar game). Tidak pernah throw:
// gagal → kembalikan [] dan UI fallback ke potong manual.
const GAME_KEYWORDS: { re: RegExp; label: (m: RegExpMatchArray) => string }[] = [
  { re: /game\s*(\d+)/i, label: (m) => `Game ${m[1]}` },
  { re: /match\s*(\d+)/i, label: (m) => `Match ${m[1]}` },
  { re: /game\s*point/i, label: () => 'Game Point' },
  { re: /match\s*point/i, label: () => 'Match Point' },
  { re: /victory/i, label: () => 'Victory' },
  { re: /defeat/i, label: () => 'Defeat' },
  { re: /\bmenang\b/i, label: () => 'Menang' },
  { re: /\bkalah\b/i, label: () => 'Kalah' },
  { re: /draft\s*(pick|phase)?/i, label: () => 'Draft Pick' },
  { re: /banning?\s*phase/i, label: () => 'Banning Phase' },
];

async function findSilenceGaps(audioPath: string | null, ffmpegPath = 'ffmpeg', minSilenceSec = 8): Promise<{ time: number; duration: number }[]> {
  if (!audioPath) return [];
  try {
    const { stdout, stderr } = await runCmd(
      `"${ffmpegPath}" -hide_banner -i "${audioPath}" -af silencedetect=noise=-35dB:d=${minSilenceSec} -f null -`
    );
    const out = `${stdout || ''}\n${stderr || ''}`;
    const gaps = [];
    const re = /silence_(start|end):\s*(-?[\d.]+)/g;
    let m;
    let pendingStart = null;
    while ((m = re.exec(out)) !== null) {
      if (m[1] === 'start') {
        pendingStart = parseFloat(m[2]);
      } else if (m[1] === 'end' && pendingStart != null) {
        const end = parseFloat(m[2]);
        if (Number.isFinite(pendingStart) && Number.isFinite(end) && end - pendingStart >= minSilenceSec) {
          gaps.push({ time: Math.floor((pendingStart + end) / 2), duration: Math.round(end - pendingStart) });
        }
        pendingStart = null;
      }
    }
    return gaps;
  } catch {
    return [];
  }
}

async function detectGameBreaks(segments: TranscriptSegment[], audioPath: string | null = null, ffmpegPath = 'ffmpeg'): Promise<GameBreak[]> {
  const breaks: GameBreak[] = [];
  try {
    const segs = Array.isArray(segments) ? segments : [];
    const totalDur = segs.length > 0 ? Math.max(...segs.map((s) => Number(s.end) || 0)) : 0;

    // 1. Keyword hits (batas antar game biasanya disebut caster)
    for (const s of segs) {
      const text = String(s.text || '');
      if (!text.trim()) continue;
      for (const kw of GAME_KEYWORDS) {
        const m = kw.re.exec(text);
        if (m) {
          breaks.push({ time: Math.max(0, Math.floor(Number(s.start) || 0)), label: kw.label(m), source: 'keyword' });
          break;
        }
      }
    }

    // 2. Jeda sunyi panjang (draft / jeda antar game)
    if (audioPath) {
      const gaps = await findSilenceGaps(audioPath, ffmpegPath, 8);
      for (const g of gaps) breaks.push({ time: g.time, label: `Jeda sunyi ${g.duration}s`, source: 'silence' });
    }

    // 3. Merge: keyword + silence dalam 90s dianggap satu batas (keyword menang)
    breaks.sort((a, b) => a.time - b.time);
    const merged: GameBreak[] = [];
    for (const b of breaks) {
      const last = merged[merged.length - 1];
      if (last && Math.abs(b.time - last.time) <= 90) {
        if (last.source === 'silence' && b.source === 'keyword') {
          last.label = b.label;
          last.source = 'keyword';
          last.time = Math.min(last.time, b.time);
        }
        continue;
      }
      merged.push({ ...b });
    }

    // Buang break di 60 detik pertama (opening, bukan batas game)
    return merged
      .filter((b) => b.time >= 60 && (!totalDur || b.time <= totalDur - 30))
      .slice(0, 20);
  } catch {
    return [];
  }
}

export {
  transcribeAudio,
  detectViralMoments,
  detectGameBreaks,
  generateAssSubtitle,
  generateSocialCaption,
  // Pure helpers (exported for local testing)
  parseJsonArray,
  parseJsonObject,
  snapToSegmentBoundary,
  sanitizeMoments,
  chunkTranscriptWindows,
  analyzeAudioEnergy,
  analyzeFaceReaction,
  scoreSegmentEmotion,
  findEmotionPeaks,
  fusePeakRegions,
};

