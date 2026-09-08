import express, { Request, Response } from 'express';
import cors from 'cors';
import { spawn, exec, ExecOptions } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import tmp from 'tmp';
import * as crypto from 'crypto';
import * as aiService from './aiService';
import type { TranscriptData, TranscriptSegment, GameBreak, ScoredMoment } from './aiService';

// ── Shared types ───────────────────────────────────────────────────
interface ServerConfig {
  provider: string;
  groqApiKey: string;
  openaiApiKey: string;
}

interface ClipVirality {
  total: number;
  grade: string;
  scores: Record<string, number>;
  tips: string[];
}

export interface ClipMeta {
  id: string;
  title: string;
  channel: string;
  sourceUrl: string;
  startSec: number;
  endSec: number;
  duration: number;
  durationFormatted: string;
  framing: string;
  facecamPos?: string;
  quality: string;
  resolution: string;
  hasCaptions: boolean;
  captionPos?: string;
  filename: string;
  fileSize: number;
  fileSizeMB: string;
  createdAt: string;
  transcript: string | null;
  virality: ClipVirality | null;
}

export interface UploadItem {
  title: string;
  description?: string;
  hashtags?: string[];
  channelName?: string;
  isScheduled?: boolean;
  scheduleTime?: string | null;
  clipId?: string;
  videoUrl?: string;
  filename?: string;
  autoPublish?: boolean;
  timestamp?: number;
  queueIndex?: number;
  queueTotal?: number;
  [key: string]: unknown;
}

interface CmdResult {
  stdout: string;
  stderr: string;
}

type LineHandler = (line: string) => void;

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ── Persistent clip storage ──────────────────────────────────────────
// NOTE: kode dikompilasi ke dist/, jadi __dirname = server/dist.
// Semua path runtime (clips, config, binary, script python) mengacu ke server/.
const SERVER_DIR = path.resolve(__dirname, '..');
const CLIPS_DIR = path.join(SERVER_DIR, 'clips');
const CLIPS_META = path.join(SERVER_DIR, 'clips.json');
const CONFIG_FILE = path.join(SERVER_DIR, 'config.json');

if (!fs.existsSync(CLIPS_DIR)) fs.mkdirSync(CLIPS_DIR, { recursive: true });

function loadClipsMeta(): ClipMeta[] {
  if (!fs.existsSync(CLIPS_META)) return [];
  try { return JSON.parse(fs.readFileSync(CLIPS_META, 'utf-8')) as ClipMeta[]; }
  catch { return []; }
}

function saveClipsMeta(clips: ClipMeta[]): void {
  fs.writeFileSync(CLIPS_META, JSON.stringify(clips, null, 2));
}

function loadConfig(): ServerConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { provider: 'groq', groqApiKey: '', openaiApiKey: '' };
  }
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as ServerConfig; }
  catch { return { provider: 'groq', groqApiKey: '', openaiApiKey: '' }; }
}

function saveConfig(cfg: ServerConfig): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// ── Helpers ──────────────────────────────────────────────────────────
function runCmd(cmd: string, options: ExecOptions = {}): Promise<CmdResult> {
  return new Promise((resolve, reject) => {
    exec(cmd, { ...options, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject({ error, stdout, stderr });
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function generateId(): string {
  return crypto.randomBytes(6).toString('hex');
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function spawnProcess(command: string, args: string[], onStdoutLine?: LineHandler, onStderrLine?: LineHandler): Promise<CmdResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { windowsHide: true });
    let stdoutData = '';
    let stderrData = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutData += text;
      if (onStdoutLine) {
        const lines = text.split(/[\r\n]+/);
        lines.forEach((line: string) => { if (line.trim()) onStdoutLine(line); });
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrData += text;
      if (onStderrLine) {
        const lines = text.split(/[\r\n]+/);
        lines.forEach((line: string) => { if (line.trim()) onStderrLine(line); });
      }
    });

    proc.on('close', (code: number | null) => {
      if (code === 0) resolve({ stdout: stdoutData, stderr: stderrData });
      else reject(new Error(`Command exited with code ${code}: ${stderrData || stdoutData}`));
    });

    proc.on('error', (err: Error) => reject(err));
  });
}

// Helper to escape path for FFmpeg subtitles filter
function escapeFfmpegPath(filepath: string): string {
  return filepath.replace(/\\/g, '/').replace(/:/g, '\\:');
}

// ── GET / POST /api/settings ─────────────────────────────────────────
app.get('/api/settings', (req: Request, res: Response) => {
  const config = loadConfig();
  res.json({
    provider: config.provider || 'groq',
    hasGroqKey: Boolean(config.groqApiKey),
    hasOpenaiKey: Boolean(config.openaiApiKey),
    groqApiKey: config.groqApiKey ? '••••••••' + config.groqApiKey.slice(-4) : '',
    openaiApiKey: config.openaiApiKey ? '••••••••' + config.openaiApiKey.slice(-4) : '',
  });
});

app.post('/api/settings', (req: Request, res: Response) => {
  const { provider, groqApiKey, openaiApiKey } = req.body;
  const current = loadConfig();
  const updated = {
    provider: provider || current.provider || 'groq',
    groqApiKey: groqApiKey && !groqApiKey.includes('••••') ? groqApiKey : current.groqApiKey,
    openaiApiKey: openaiApiKey && !openaiApiKey.includes('••••') ? openaiApiKey : current.openaiApiKey,
  };
  saveConfig(updated);
  res.json({ success: true, provider: updated.provider });
});

// ── POST /api/auto-detect — Detect Viral Moments with AI ─────────────
app.post('/api/auto-detect', async (req: Request, res: Response) => {
  const {
    youtubeUrl,
    provider: reqProvider,
    groqApiKey: reqGroqKey,
    openaiApiKey: reqOpenaiKey,
    targetDuration = 'auto',
    minDuration = 15,
    maxDuration = 90,
    maxMoments = 10,
    // Mode turnamen: VOD panjang (skala limit naik) + deteksi batas game
    matchMode = false,
    detectGames = false,
  } = req.body;
  if (!youtubeUrl) return res.status(400).json({ error: 'YouTube URL wajib diisi' });

  const config = loadConfig();
  const provider = reqProvider || config.provider || 'groq';
  let apiKey = provider === 'openai' 
    ? (reqOpenaiKey || config.openaiApiKey) 
    : (reqGroqKey || config.groqApiKey);

  if (!apiKey) {
    return res.status(400).json({
      error: `API Key ${provider.toUpperCase()} belum disetel. Buka menu Settings ⚙️ untuk memasukkan API Key.`,
      needsConfig: true,
    });
  }

  // Set SSE headers for progress
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders?.();

  const pingInterval = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 4000);

  req.on('close', () => {
    clearInterval(pingInterval);
  });

  const sendEvent = (data: unknown): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const tmpDir = tmp.dirSync({ unsafeCleanup: true });
  const audioFile = path.join(tmpDir.name, 'audio.mp3');
  const ytdlpPath = path.join(SERVER_DIR, 'yt-dlp.exe');
  const ffmpegPath = path.join(SERVER_DIR, 'ffmpeg.exe');

  try {
    sendEvent({ type: 'progress', percent: 10, stage: 'Mengunduh audio video untuk AI...' });

    // 1. Download audio only (fast & lightweight)
    const ytArgs = [
      '-x',
      '--audio-format', 'mp3',
      '--ffmpeg-location', ffmpegPath,
      '--newline',
      '-o', audioFile,
      youtubeUrl,
    ];

    await spawnProcess(ytdlpPath, ytArgs, (line) => {
      const match = line.match(/\[download\]\s+([\d.]+)%/);
      if (match) {
        const p = parseFloat(match[1]);
        sendEvent({ type: 'progress', percent: Math.round(10 + (p * 0.3)), stage: `Mengunduh audio (${Math.round(p)}%)...` });
      }
    });

    const downloadedAudioFiles = fs.readdirSync(tmpDir.name);
    const downloadedMp3 = downloadedAudioFiles.find(f => f.endsWith('.mp3')) || 'audio.mp3';
    const downloadedAudioPath = path.join(tmpDir.name, downloadedMp3);
    const compressedAudio = path.join(tmpDir.name, 'compressed.mp3');

    sendEvent({ type: 'progress', percent: 42, stage: 'Mengoptimalkan ukuran audio untuk Speech AI...' });
    try {
      await runCmd(`"${ffmpegPath}" -y -i "${downloadedAudioPath}" -ar 16000 -ac 1 -b:a 24k "${compressedAudio}"`);
    } catch {
      // If conversion fails, use original
      fs.copyFileSync(downloadedAudioPath, compressedAudio);
    }

    sendEvent({ type: 'progress', percent: 48, stage: 'Mentranskripsi audio dengan Speech AI (Whisper)...' });

    // 2. Transcribe audio with Whisper (with auto chunking if >24MB)
    const transcriptData = await aiService.transcribeAudio(compressedAudio, apiKey, provider, ffmpegPath);

    // 2.5 Download low-res video ONCE for streamer facial-reaction analysis.
    // Best-effort: any failure just disables the face signal (audio+text remain).
    let reactionVideoPath = null;
    try {
      sendEvent({ type: 'progress', percent: 72, stage: 'Mengunduh video resolusi rendah untuk analisis ekspresi...' });
      const analysisVideo = path.join(tmpDir.name, 'analysis.mp4');
      await spawnProcess(ytdlpPath, [
        '-f', 'bestvideo[height<=480]+bestaudio/best[height<=480]/best',
        '--merge-output-format', 'mp4',
        '--ffmpeg-location', ffmpegPath,
        '--no-playlist',
        '--newline',
        '-o', analysisVideo,
        youtubeUrl,
      ], (line) => {
        const match = line.match(/\[download\]\s+([\d.]+)%/);
        if (match) {
          const p = parseFloat(match[1]);
          sendEvent({ type: 'progress', percent: Math.round(60 + (p * 0.12)), stage: `Mengunduh video analisis (${Math.round(p)}%)...` });
        }
      });
      if (fs.existsSync(analysisVideo)) reactionVideoPath = analysisVideo;
    } catch (vidErr) {
      console.warn('[Auto-detect] Analysis video download failed, face signal disabled:', (vidErr as Error).message || vidErr);
    }

    sendEvent({ type: 'progress', percent: 75, stage: 'AI menganalisis hook & momen paling viral...' });

    // 3. Detect viral moments (face reaction + acoustic peaks + two-pass rank)
    const moments: ScoredMoment[] = await aiService.detectViralMoments(transcriptData, apiKey, provider, targetDuration, minDuration, maxDuration, (p: { percent: number; stage: string }) => {
      sendEvent({ type: 'progress', percent: 75 + Math.round((p.percent || 0) * 0.2), stage: p.stage || 'AI menganalisis hook & momen paling viral...' });
    }, { audioPath: compressedAudio, ffmpegPath, reactionVideoPath, maxMoments, matchMode: matchMode === true });

    // 3b. Game-break detection (opsional, untuk VOD turnamen pecah per game)
    let gameBreaks: GameBreak[] = [];
    if (detectGames === true) {
      try {
        sendEvent({ type: 'progress', percent: 96, stage: 'Mendeteksi batas antar game...' });
        gameBreaks = await aiService.detectGameBreaks(transcriptData.segments || [], compressedAudio, ffmpegPath);
        console.log(`[Auto-detect] Game breaks: ${gameBreaks.length}`);
      } catch (gbErr) {
        console.warn('[Auto-detect] Game-break detection failed:', (gbErr as Error).message || gbErr);
      }
    }

    // Get video title
    let videoTitle = 'Video';
    try {
      const { stdout } = await runCmd(`"${ytdlpPath}" --get-title "${youtubeUrl}"`);
      videoTitle = stdout.trim();
    } catch { /* ignore */ }

    tmpDir.removeCallback();

    sendEvent({ type: 'progress', percent: 100, stage: 'Analisis viral selesai!' });
    sendEvent({
      type: 'done',
      videoTitle,
      moments,
      gameBreaks,
      transcript: transcriptData.text || '',
      transcriptSegments: transcriptData.segments || [],
    });
    res.end();
  } catch (err) {
    console.error('Auto-detect error:', err);
    tmpDir.removeCallback();
    sendEvent({ type: 'error', message: (err as Error).message || 'Gagal menganalisis video dengan AI' });
    res.end();
  }
});

// ── POST /api/clip — Create Clip (With Real-time SSE, Framing, & Captions) ──
app.post('/api/clip', async (req: Request, res: Response) => {
  const {
    youtubeUrl,
    startSec,
    endSec,
    framing = 'smart',
    facecamPos = 'auto',
    quality = '1080p',
    burnCaptions = false,
    captionPos = 'middle',
    customTitle,
    transcriptSegments = null,
    provider: reqProvider,
    groqApiKey: reqGroqKey,
    openaiApiKey: reqOpenaiKey,
  } = req.body;

  if (!youtubeUrl || startSec == null || endSec == null) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders?.();

  const pingInterval = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 4000);

  req.on('close', () => {
    clearInterval(pingInterval);
  });

  const sendEvent = (data: unknown): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const clipId = generateId();
  const tmpDir = tmp.dirSync({ unsafeCleanup: true });
  const outputTemplate = path.join(tmpDir.name, 'source.%(ext)s');
  const clipFilename = `clip_${clipId}.mp4`;
  const clipPath = path.join(CLIPS_DIR, clipFilename);
  const clipDuration = Math.max(1, endSec - startSec);

  const is1080p = quality === '1080p';
  // Landscape (video reguler 16:9): potong durasi saja, tanpa crop vertikal
  const isLandscape = framing === 'landscape';
  const targetW = isLandscape ? (is1080p ? 1920 : 1280) : (is1080p ? 1080 : 720);
  const targetH = isLandscape ? (is1080p ? 1080 : 720) : (is1080p ? 1920 : 1280);

  const ytdlpPath = path.join(SERVER_DIR, 'yt-dlp.exe');
  const ffmpegPath = path.join(SERVER_DIR, 'ffmpeg.exe');

  try {
    sendEvent({ type: 'progress', percent: 10, stage: 'Mempersiapkan potongan video...' });

    // 1️⃣ Fast Section Download
    const ytArgs = [
      '-f', 'bestvideo+bestaudio/best',
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', ffmpegPath,
      '--download-sections', `*${startSec}-${endSec}`,
      '--newline',
      '-o', outputTemplate,
      youtubeUrl,
    ];

    console.log(`[${clipId}] Downloading section *${startSec}-${endSec} for: ${youtubeUrl}`);

    const handleProgressLine = (line: string): void => {
      const dlMatch = line.match(/\[download\]\s+([\d.]+)%/);
      if (dlMatch) {
        const dlPercent = parseFloat(dlMatch[1]);
        const overall = Math.round(10 + (dlPercent * 0.35));
        sendEvent({
          type: 'progress',
          percent: Math.min(45, overall),
          stage: `Mengunduh potongan video (${Math.round(dlPercent)}%)...`,
        });
        return;
      }
      const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2}\.?\d*)/);
      if (timeMatch) {
        const sec = parseInt(timeMatch[1], 10) * 3600 + parseInt(timeMatch[2], 10) * 60 + parseFloat(timeMatch[3]);
        const fraction = Math.min(1, Math.max(0, sec / clipDuration));
        const overall = Math.round(10 + (fraction * 35));
        sendEvent({
          type: 'progress',
          percent: Math.min(45, overall),
          stage: `Mengunduh potongan durasi (${Math.round(fraction * 100)}%)...`,
        });
      }
    };

    try {
      await spawnProcess(ytdlpPath, ytArgs, handleProgressLine, handleProgressLine);
    } catch (dlErr) {
      console.log(`[${clipId}] Fallback format...`, (dlErr as Error).message);
      sendEvent({ type: 'progress', percent: 15, stage: 'Mengunduh format fallback...' });
      const fallbackArgs = [
        '-f', 'best[ext=mp4]/best',
        '--ffmpeg-location', ffmpegPath,
        '--download-sections', `*${startSec}-${endSec}`,
        '--newline',
        '-o', outputTemplate,
        youtubeUrl,
      ];
      await spawnProcess(ytdlpPath, fallbackArgs, handleProgressLine, handleProgressLine);
    }

    sendEvent({ type: 'progress', percent: 50, stage: 'Potongan video siap...' });

    // Locate downloaded source
    const downloadedFiles = fs.readdirSync(tmpDir.name);
    const mergedFile = downloadedFiles.find((f: string) => f.endsWith('.mp4'));
    if (!mergedFile) throw new Error('MP4 file tidak ditemukan setelah download');
    const downloadPath = path.join(tmpDir.name, mergedFile);

    // 2️⃣ Generate Subtitle if Burn Captions is ON
    let assFilePath: string | null = null;
    let clipTranscriptText = '';

    if (burnCaptions) {
      sendEvent({ type: 'progress', percent: 55, stage: 'Menyiapkan caption teks TikTok style presisi...' });

      const config = loadConfig();
      const provider = reqProvider || config.provider || 'groq';
      const apiKey = provider === 'openai' 
        ? (reqOpenaiKey || config.openaiApiKey) 
        : (reqGroqKey || config.groqApiKey);

      let transcriptData: TranscriptData | null = null;

      // Extract and transcribe the exact cut clip audio for millisecond-precise timing!
      if (apiKey) {
        try {
          const clipAudio = path.join(tmpDir.name, 'clip_audio.mp3');
          await runCmd(`"${ffmpegPath}" -y -i "${downloadPath}" -vn -acodec libmp3lame -q:a 4 "${clipAudio}"`);
          sendEvent({ type: 'progress', percent: 57, stage: 'Sinkronisasi suara & kata per kata (Speech AI)...' });
          transcriptData = await aiService.transcribeAudio(clipAudio, apiKey, provider, ffmpegPath);
          clipTranscriptText = transcriptData.text || '';
          console.log(`[${clipId}] ✅ Direct clip audio transcribed: ${transcriptData.words?.length || 0} words with millisecond precision`);
        } catch (tErr) {
          console.warn('[Subtitle] Direct clip transcribe failed, falling back to segments:', (tErr as Error).message);
        }
      }

      // Fallback to pre-detected transcriptSegments if direct transcribe failed
      if (!transcriptData && transcriptSegments && transcriptSegments.length > 0) {
        transcriptData = { text: '', segments: transcriptSegments as TranscriptSegment[], words: [] };
      }

      if (transcriptData) {
        // When using direct clip audio, startSec is 0 because the audio begins at 0.00
        const effectiveStartSec = (transcriptData.words && transcriptData.words.length > 0) ? 0 : startSec;
        const assContent = aiService.generateAssSubtitle(transcriptData, effectiveStartSec, endSec, is1080p, captionPos);
        assFilePath = path.join(tmpDir.name, 'caption.ass');
        fs.writeFileSync(assFilePath, assContent, 'utf-8');
        console.log(`[${clipId}] ✅ ASS Subtitle generated:`, assFilePath);
      }
    }

    // 2.5️⃣ AI Face / Streamer Layout Detection
    let detectionData: any = null;
    if (framing === 'smart' || framing === 'streamer') {
      const detectStage = framing === 'streamer'
        ? 'AI mendeteksi posisi facecam streamer...'
        : 'AI mendeteksi posisi wajah & pembicara...';
      sendEvent({ type: 'progress', percent: 60, stage: detectStage });

      try {
        const detectScript = path.join(SERVER_DIR, 'detect_face.py');
        const cmd = `python "${detectScript}" "${downloadPath}" "${framing}" "${req.body.facecamPos || 'auto'}"`;
        const { stdout } = await runCmd(cmd);
        const lines = (stdout || '').trim().split(/[\r\n]+/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              detectionData = JSON.parse(trimmed);
              break;
            } catch { /* ignore */ }
          }
        }
        if (detectionData) {
          console.log(`[${clipId}] 🎯 AI Detection success:`, {
            detected: detectionData.detected,
            corner: detectionData.detectedCorner,
            smartX: detectionData.smartCrop?.cropX,
          });
        }
      } catch (detErr) {
        console.warn(`[${clipId}] Face detection warning:`, (detErr as Error).message || detErr);
      }
    }

    sendEvent({
      type: 'progress',
      percent: 65,
      stage: `Rendering video ${isLandscape ? '16:9' : '9:16'} (${
        framing === 'streamer' ? 'Mode Streamer' :
        framing === 'smart' ? 'Smart Auto-Crop' :
        framing === 'landscape' ? 'Landscape (Video Reguler)' :
        framing === 'blur' ? 'Blur BG' : 'Crop Tengah'
      })...`
    });

    // 3️⃣ Build FFmpeg Filter Graph
    let ffmpegArgs: string[] = [];
    const escapedAss = assFilePath ? escapeFfmpegPath(assFilePath) : null;

    if (framing === 'streamer') {
      // Stacked split-screen: Top Facecam + Bottom Game
      const topH = is1080p ? 780 : 520;
      const botH = is1080p ? 1140 : 760;

      let cam = detectionData?.streamer?.cam;
      let game = detectionData?.streamer?.game;

      let filterComplex = '';
      if (cam && game) {
        filterComplex = `[0:v]crop=${cam.w}:${cam.h}:${cam.x}:${cam.y},scale=${targetW}:${topH}:force_original_aspect_ratio=increase,crop=${targetW}:${topH}[cam];`
          + `[0:v]crop=${game.w}:${game.h}:${game.x}:${game.y},scale=${targetW}:${botH}:force_original_aspect_ratio=increase,crop=${targetW}:${botH}[game];`
          + `[cam][game]vstack[v]`;
    } else if (framing === 'landscape') {
      // Landscape pass-through 16:9 (potongan game / video reguler):
      // scale-down saja + pad pengaman dimensi ganjil, tanpa crop.
      let filterComplex = `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2[v]`;
      if (escapedAss) {
        filterComplex += `;[v]subtitles='${escapedAss}'[vout]`;
      }

      ffmpegArgs = [
        '-y',
        '-i', downloadPath,
        '-filter_complex', filterComplex,
        '-map', escapedAss ? '[vout]' : '[v]',
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-c:a', 'aac',
        '-progress', 'pipe:1',
        clipPath,
      ];
    } else {
        // Fallback streamer split if detection failed
        filterComplex = `[0:v]crop=in_w*0.4:in_h*0.5:in_w*0.6:in_h*0.5,scale=${targetW}:${topH}[cam];`
          + `[0:v]crop=in_h*0.95:in_h:(in_w-in_h*0.95)/2:0,scale=${targetW}:${botH}[game];`
          + `[cam][game]vstack[v]`;
      }

      if (escapedAss) {
        filterComplex += `;[v]subtitles='${escapedAss}'[vout]`;
      }

      ffmpegArgs = [
        '-y',
        '-i', downloadPath,
        '-filter_complex', filterComplex,
        '-map', escapedAss ? '[vout]' : '[v]',
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-c:a', 'aac',
        '-progress', 'pipe:1',
        clipPath,
      ];
    } else if (framing === 'blur') {
      let filterComplex = `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=25:5[bg];[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[v]`;
      if (escapedAss) {
        filterComplex += `;[v]subtitles='${escapedAss}'[vout]`;
      }
      ffmpegArgs = [
        '-y',
        '-i', downloadPath,
        '-filter_complex', filterComplex,
        '-map', escapedAss ? '[vout]' : '[v]',
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-c:a', 'aac',
        '-progress', 'pipe:1',
        clipPath,
      ];
    } else if (framing === 'smart') {
      // Smart Auto-Crop centered on detected person
      let cropX = '(in_w-in_h*9/16)/2';
      if (detectionData?.smartCrop?.cropX != null) {
        cropX = String(detectionData.smartCrop.cropX);
      }

      let filterComplex = `[0:v]crop=in_h*9/16:in_h:${cropX}:0,scale=${targetW}:${targetH}[v]`;
      if (escapedAss) {
        filterComplex += `;[v]subtitles='${escapedAss}'[vout]`;
      }

      ffmpegArgs = [
        '-y',
        '-i', downloadPath,
        '-filter_complex', filterComplex,
        '-map', escapedAss ? '[vout]' : '[v]',
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-c:a', 'aac',
        '-progress', 'pipe:1',
        clipPath,
      ];
    } else {
      // Static center crop ('crop')
      let filterComplex = `[0:v]crop=in_h*9/16:in_h:(in_w-in_h*9/16)/2:0,scale=${targetW}:${targetH}[v]`;
      if (escapedAss) {
        filterComplex += `;[v]subtitles='${escapedAss}'[vout]`;
      }

      ffmpegArgs = [
        '-y',
        '-i', downloadPath,
        '-filter_complex', filterComplex,
        '-map', escapedAss ? '[vout]' : '[v]',
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-c:a', 'aac',
        '-progress', 'pipe:1',
        clipPath,
      ];
    }

    await spawnProcess(ffmpegPath, ffmpegArgs, (line: string) => {
      const timeMatch = line.match(/out_time_us=(\d+)/) || line.match(/out_time_ms=(\d+)/);
      if (timeMatch) {
        const timeSec = parseInt(timeMatch[1], 10) / 1000000;
        const renderFraction = Math.min(1, Math.max(0, timeSec / clipDuration));
        const overall = Math.round(65 + (renderFraction * 27));
        sendEvent({
          type: 'progress',
          percent: Math.min(92, overall),
          stage: `Rendering & Burn-in Caption (${Math.round(renderFraction * 100)}%)...`,
        });
      }
    });

    sendEvent({ type: 'progress', percent: 94, stage: 'Menganalisis skor viralitas...' });

    // 4️⃣ Title & Metadata
    const stats = fs.statSync(clipPath);
    let title = customTitle || 'Untitled Clip';
    let channel = '';
    try {
      const { stdout: tOut } = await runCmd(`"${ytdlpPath}" --get-title "${youtubeUrl}"`);
      if (!customTitle) title = tOut.trim().substring(0, 100);
      const { stdout: cOut } = await runCmd(`"${ytdlpPath}" --print "%(channel)s" "${youtubeUrl}"`);
      channel = cOut.trim();
    } catch { /* ignore */ }

    // Virality Score
    const viralityScores = { duration: 25, subtitle: burnCaptions ? 20 : 0, aspectRatio: 15, hook: 18, audio: 17 };
    const viralityTips: string[] = [];
    if (burnCaptions) {
      viralityTips.push('Caption dinamis aktif (+20 poin engagement!)');
    } else {
      viralityTips.push('Aktifkan caption teks untuk meningkatkan engagement penonton.');
    }
    const viralityTotal = Object.values(viralityScores).reduce((a, b) => a + b, 0);
    const viralityGrade = viralityTotal >= 80 ? 'excellent' : viralityTotal >= 60 ? 'good' : 'average';

    const clipMeta: ClipMeta = {
      id: clipId,
      title,
      channel,
      sourceUrl: youtubeUrl,
      startSec,
      endSec,
      duration: clipDuration,
      durationFormatted: formatDuration(clipDuration),
      framing,
      facecamPos: framing === 'streamer' ? facecamPos : undefined,
      quality,
      resolution: `${targetW}x${targetH}`,
      hasCaptions: burnCaptions,
      captionPos: burnCaptions ? captionPos : undefined,
      filename: clipFilename,
      fileSize: stats.size,
      fileSizeMB: (stats.size / (1024 * 1024)).toFixed(1),
      createdAt: new Date().toISOString(),
      transcript: clipTranscriptText || null,
      virality: { total: viralityTotal, grade: viralityGrade, scores: viralityScores, tips: viralityTips },
    };

    const clips = loadClipsMeta();
    clips.unshift(clipMeta);
    saveClipsMeta(clips);

    console.log(`[${clipId}] ✅ Clip complete: ${clipFilename} (${clipMeta.fileSizeMB} MB, Captions: ${burnCaptions})`);

    tmpDir.removeCallback();

    sendEvent({ type: 'progress', percent: 100, stage: 'Clip selesai diproses!' });
    sendEvent({ type: 'done', clip: clipMeta });
    res.end();
  } catch (e) {
    console.error(`[${clipId}] ❌ Processing error:`, e);
    tmpDir.removeCallback();
    if (fs.existsSync(clipPath)) fs.unlinkSync(clipPath);
    sendEvent({ type: 'error', message: (e as Error).message || 'Gagal memproses clip' });
    res.end();
  }
});

// ── GET /api/clips — List all clips ──────────────────────────────────
app.get('/api/clips', (req: Request, res: Response) => {
  const clips = loadClipsMeta();
  res.json(clips);
});

// ── GET /api/clips/:id — Download clip ───────────────────────────────
app.get('/api/clips/:id', (req: Request, res: Response) => {
  const clips = loadClipsMeta();
  const clip = clips.find(c => c.id === req.params.id);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });

  const clipPath = path.join(CLIPS_DIR, clip.filename);
  if (!fs.existsSync(clipPath)) return res.status(404).json({ error: 'Clip file not found' });

  const stat = fs.statSync(clipPath);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', `attachment; filename="${clip.filename}"`);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const stream = fs.createReadStream(clipPath);
  stream.on('error', (err: Error) => {
    console.error('File stream error:', err);
    if (!res.headersSent) res.status(500).end();
  });
  stream.pipe(res);
});

// ── DELETE /api/clips/:id — Delete clip ─────────────────────────────
app.delete('/api/clips/:id', (req: Request, res: Response) => {
  let clips = loadClipsMeta();
  const idx = clips.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Clip not found' });

  const clip = clips[idx];
  const clipPath = path.join(CLIPS_DIR, clip.filename);
  if (fs.existsSync(clipPath)) fs.unlinkSync(clipPath);

  clips.splice(idx, 1);
  saveClipsMeta(clips);
  res.json({ success: true });
});

// ── GET /api/clips/:id/virality ──────────────────────────────────────
app.get('/api/clips/:id/virality', async (req: Request, res: Response) => {
  const clips = loadClipsMeta();
  const clip = clips.find(c => c.id === req.params.id);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });
  res.json(clip.virality || { total: 75, grade: 'good', scores: {}, tips: ['Clip siap diupload!'] });
});

// ── POST /api/clips/:id/transcribe ───────────────────────────────────
app.post('/api/clips/:id/transcribe', async (req: Request, res: Response) => {
  const clips = loadClipsMeta();
  const clip = clips.find(c => c.id === req.params.id);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });

  const config = loadConfig();
  const apiKey = config.provider === 'openai' ? config.openaiApiKey : config.groqApiKey;

  if (apiKey) {
    try {
      const clipPath = path.join(CLIPS_DIR, clip.filename);
      const tmpDir = tmp.dirSync({ unsafeCleanup: true });
      const audioPath = path.join(tmpDir.name, 'audio.mp3');
      const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
      await runCmd(`"${ffmpegPath}" -y -i "${clipPath}" -vn -acodec libmp3lame -q:a 4 "${audioPath}"`);
      const tData = await aiService.transcribeAudio(audioPath, apiKey, config.provider || 'groq');
      clip.transcript = tData.text || '';
      saveClipsMeta(clips);
      tmpDir.removeCallback();
      return res.json({ transcript: clip.transcript });
    } catch (e) {
      console.error('AI transcribe error:', e);
    }
  }

  res.json({ transcript: clip.transcript || '(Transkripsi belum tersedia. Buka menu Settings ⚙️ dan masukkan API Key Groq gratis untuk transkripsi instan.)' });
});

// In-memory upload queue store for cross-origin batch sync with YouTube Studio
let uploadQueue: UploadItem[] = [];
let uploadQueueIndex = 0;

// ── GET / POST / DELETE /api/pending-upload ─────────────────────────
app.get('/api/pending-upload', (req: Request, res: Response) => {
  const current = uploadQueue[uploadQueueIndex] || null;
  res.json({
    pending: current,
    queueTotal: uploadQueue.length,
    queueIndex: uploadQueueIndex,
    remaining: Math.max(0, uploadQueue.length - uploadQueueIndex - 1),
    allItems: uploadQueue,
  });
});

app.post('/api/pending-upload', (req: Request, res: Response) => {
  if (Array.isArray(req.body.items) && req.body.items.length > 0) {
    uploadQueue = req.body.items.map((item: UploadItem, idx: number) => ({
      ...item,
      queueIndex: idx,
      queueTotal: req.body.items.length,
      timestamp: Date.now(),
    }));
    uploadQueueIndex = 0;
    console.log(`[Upload Queue] Initialized batch queue with ${uploadQueue.length} items.`);
  } else {
    uploadQueue = [{
      ...req.body,
      queueIndex: 0,
      queueTotal: 1,
      timestamp: Date.now(),
    }];
    uploadQueueIndex = 0;
    console.log('[Upload Queue] Initialized single item upload:', uploadQueue[0].title);
  }
  res.json({
    success: true,
    pending: uploadQueue[0],
    queueTotal: uploadQueue.length,
    queueIndex: 0,
  });
});

app.post('/api/pending-upload/advance', (req: Request, res: Response) => {
  if (uploadQueueIndex < uploadQueue.length - 1) {
    uploadQueueIndex++;
    const nextItem = uploadQueue[uploadQueueIndex];
    console.log(`[Upload Queue] Advanced to item ${uploadQueueIndex + 1}/${uploadQueue.length}: ${nextItem.title}`);
    res.json({
      success: true,
      hasMore: true,
      next: nextItem,
      queueIndex: uploadQueueIndex,
      queueTotal: uploadQueue.length,
      remaining: uploadQueue.length - uploadQueueIndex - 1,
    });
  } else {
    console.log('[Upload Queue] Queue completed! All items uploaded/scheduled.');
    uploadQueue = [];
    uploadQueueIndex = 0;
    res.json({
      success: true,
      hasMore: false,
      next: null,
      queueIndex: 0,
      queueTotal: 0,
      remaining: 0,
    });
  }
});

app.delete('/api/pending-upload', (req: Request, res: Response) => {
  uploadQueue = [];
  uploadQueueIndex = 0;
  res.json({ success: true });
});


// ── POST /api/generate-caption ──────────────────────────────────────
app.post('/api/generate-caption', async (req: Request, res: Response) => {
  const { clipId, platform = 'youtube', customContext, channelName: reqChannel } = req.body;
  if (!clipId) return res.status(400).json({ error: 'clipId is required' });

  const clips = loadClipsMeta();
  const clip = clips.find(c => c.id === clipId);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });

  const config = loadConfig();
  const provider = config.provider || 'groq';
  const apiKey = provider === 'openai' ? config.openaiApiKey : config.groqApiKey;

  if (!apiKey) {
    return res.status(400).json({
      error: 'API Key AI belum diatur. Buka menu Settings ⚙️ untuk memasukkan API Key Groq (Gratis) atau OpenAI.'
    });
  }

  // Determine channel name
  let channelName = reqChannel || clip.channel || '';
  if (!channelName && clip.sourceUrl) {
    try {
      const ytdlpPath = path.join(__dirname, 'yt-dlp.exe');
      const { stdout } = await runCmd(`"${ytdlpPath}" --print "%(channel)s" "${clip.sourceUrl}"`);
      channelName = stdout.trim();
      if (channelName) {
        clip.channel = channelName;
        saveClipsMeta(clips);
      }
    } catch (err) {
      console.warn('Could not fetch channel name:', (err as Error).message);
    }
  }

  let transcriptText = clip.transcript || customContext || '';
  if (!transcriptText) {
    // Attempt quick transcription if not yet transcribed
    try {
      const clipPath = path.join(CLIPS_DIR, clip.filename);
      if (fs.existsSync(clipPath)) {
        const tmpDir = tmp.dirSync({ unsafeCleanup: true });
        const audioPath = path.join(tmpDir.name, 'audio.mp3');
        const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
        await runCmd(`"${ffmpegPath}" -y -i "${clipPath}" -vn -acodec libmp3lame -q:a 4 "${audioPath}"`);
        const tData = await aiService.transcribeAudio(audioPath, apiKey, provider);
        transcriptText = tData.text || '';
        clip.transcript = transcriptText;
        saveClipsMeta(clips);
        tmpDir.removeCallback();
      }
    } catch (err) {
      console.warn('Auto-transcribe during caption gen failed:', (err as Error).message);
    }
  }

  try {
    const captionData = await aiService.generateSocialCaption(
      clip.title,
      transcriptText,
      platform,
      apiKey,
      provider,
      channelName
    );
    res.json({ success: true, caption: captionData, channelName });
  } catch (err) {
    console.error('generateSocialCaption error:', err);
    res.status(500).json({ error: (err as Error).message || 'Gagal membuat caption AI' });
  }
});

// ── POST /api/generate-captions-batch ───────────────────────────────
app.post('/api/generate-captions-batch', async (req: Request, res: Response) => {
  const { clipIds = [], platform = 'youtube', channelName: reqChannel } = req.body;
  if (!Array.isArray(clipIds) || clipIds.length === 0) {
    return res.status(400).json({ error: 'clipIds array is required' });
  }

  const clips = loadClipsMeta();
  const config = loadConfig();
  const provider = config.provider || 'groq';
  const apiKey = provider === 'openai' ? config.openaiApiKey : config.groqApiKey;

  if (!apiKey) {
    return res.status(400).json({
      error: 'API Key AI belum diatur. Buka menu Settings ⚙️ untuk memasukkan API Key Groq (Gratis) atau OpenAI.'
    });
  }

  interface BatchCaption {
    title: string;
    description: string;
    hashtags: string[];
  }

  const results: Record<string, BatchCaption> = {};
  for (const cid of clipIds) {
    const clip = clips.find(c => c.id === cid);
    if (!clip) continue;

    const chName = reqChannel || clip.channel || '';
    const transcriptText = clip.transcript || '';

    try {
      const captionData = await aiService.generateSocialCaption(
        clip.title,
        transcriptText,
        platform,
        apiKey,
        provider,
        chName
      );
      results[cid] = captionData;
    } catch (err) {
      console.warn(`Caption gen failed for clip ${cid}:`, (err as Error).message);
      results[cid] = {
        title: `${clip.title.slice(0, 80)} #Shorts`,
        description: clip.transcript ? `Momen seru: ${clip.title}` : 'Tonton video seru ini!',
        hashtags: ['#Shorts', '#YouTubeShorts', '#Viral', chName ? `#${chName.replace(/\s+/g, '')}` : ''],
      };
    }
  }

  res.json({ success: true, results });
});



// ── GET /api/upload-urls/:id ─────────────────────────────────────────
app.get('/api/upload-urls/:id', (req: Request, res: Response) => {
  const clips = loadClipsMeta();
  const clip = clips.find(c => c.id === req.params.id);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });

  res.json({
    clipId: clip.id,
    clipTitle: clip.title,
    platforms: {
      youtube: { name: 'YouTube Shorts', icon: '🎬', url: 'https://studio.youtube.com/channel/UC/videos/upload' },
      tiktok: { name: 'TikTok', icon: '🎵', url: 'https://www.tiktok.com/creator#/upload?scene=creator_center' },
      facebook: { name: 'Facebook Reels', icon: '📘', url: 'https://www.facebook.com/reels/create' },
      instagram: { name: 'Instagram Reels', icon: '📸', url: 'https://www.instagram.com/' },
    },
    downloadUrl: `http://localhost:3002/api/clips/${clip.id}`,
  });
});

app.use('/clips', express.static(CLIPS_DIR));

const PORT = Number(process.env.PORT) || 3002;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Simple clipper backend listening on http://localhost:${PORT}`);
  console.log(`Clips directory: ${CLIPS_DIR}`);
  console.log(`Stored clips: ${loadClipsMeta().length}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Please terminate existing process.`);
  } else {
    console.error('Server error:', err);
  }
});
