import * as fs from 'fs';
import * as path from 'path';
import { runCmd } from '../lib/proc';
import { SERVER_DIR } from '../lib/paths';
import type { TranscriptSegment, SignalPeak, FusedRegion, GameBreak } from './types';

// ── Audio energy analysis (scream / jumpscare / laughter spikes) ───
// Runs ffmpeg ebur128 once over the already-downloaded audio and parses
// momentary loudness (M) over time. Deterministic, no AI cost.
export async function analyzeAudioEnergy(audioPath: string, ffmpegPath = 'ffmpeg', maxPeaks = 12): Promise<SignalPeak[]> {
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

export function scoreSegmentEmotion(text: string, warBoost = false): number {
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

export function findEmotionPeaks(segments: TranscriptSegment[], windowSec = 10, minDist = 30, maxPeaks = 12, warBoost = false): SignalPeak[] {
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
export function fusePeakRegions(audioPeaks: SignalPeak[], emotionPeaks: SignalPeak[], videoDurationSec: number, halfWidth = 30, maxRegions = 12, facePeaks: SignalPeak[] = []): FusedRegion[] {
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

// ── Streamer facial-reaction peaks via analyze_reaction.py ──────
// Returns [{ time, energy, source: 'face' }]. Empty on any failure
// (no faces, missing video, python error) — caller falls back.
export async function analyzeFaceReaction(reactionVideoPath: string | null): Promise<SignalPeak[]> {
  if (!reactionVideoPath || !fs.existsSync(reactionVideoPath)) return [];
  const script = path.join(SERVER_DIR, 'analyze_reaction.py');
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

export async function findSilenceGaps(audioPath: string | null, ffmpegPath = 'ffmpeg', minSilenceSec = 8): Promise<{ time: number; duration: number }[]> {
  if (!audioPath) return [];
  try {
    const { stdout, stderr } = await runCmd(
      `"${ffmpegPath}" -hide_banner -i "${audioPath}" -af silencedetect=noise=-35dB:d=${minSilenceSec} -f null -`
    );
    const out = `${stdout || ''}\n${stderr || ''}`;
    const gaps: { time: number; duration: number }[] = [];
    const re = /silence_(start|end):\s*(-?[\d.]+)/g;
    let m: RegExpExecArray | null;
    let pendingStart: number | null = null;
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

export async function detectGameBreaks(segments: TranscriptSegment[], audioPath: string | null = null, ffmpegPath = 'ffmpeg'): Promise<GameBreak[]> {
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
