import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import tmp from 'tmp';
import * as aiService from '../ai';
import type { GameBreak, ScoredMoment } from '../ai';
import { loadConfig } from '../lib/store';
import { runCmd, spawnProcess } from '../lib/proc';
import { YTDLP_PATH, FFMPEG_PATH } from '../lib/paths';
import { getVideoCacheDir, clearVideoCache } from '../lib/cache';
import { tryFetchYouTubeSubtitles } from '../lib/ytSubs';
import { resolvePreset } from '../lib/presets';
import { createJob, updateJob, progressReporter } from '../lib/jobs';

export const autoDetectRouter = Router();

export interface DetectTaskParams {
  youtubeUrl: string;
  provider?: string;
  groqApiKey?: string;
  openaiApiKey?: string;
  targetDuration?: string;
  minDuration?: number;
  maxDuration?: number;
  maxMoments?: number;
  matchMode?: boolean;
  detectGames?: boolean;
  forceRefresh?: boolean;
  preset?: string | null;
}

export interface DetectTaskResult {
  videoTitle: string;
  moments: ScoredMoment[];
  gameBreaks: GameBreak[];
  transcript: string;
  transcriptSegments: unknown[];
}

// ── Worker: analisis AI berjalan di background server. ──
export async function runDetectTask(jobId: string, b: DetectTaskParams): Promise<DetectTaskResult> {
  const {
    youtubeUrl,
    provider: reqProvider,
    groqApiKey: reqGroqKey,
    openaiApiKey: reqOpenaiKey,
    targetDuration = 'auto',
    minDuration = 15,
    maxDuration = 90,
    maxMoments = 10,
    matchMode = false,
    detectGames = false,
    forceRefresh = false,
    preset = null,
  } = b;

  const config = loadConfig();
  const provider = reqProvider || config.provider || 'groq';
  const apiKey = provider === 'openai'
    ? (reqOpenaiKey || config.openaiApiKey)
    : (reqGroqKey || config.groqApiKey);

  if (!apiKey) {
    const err = new Error(`API Key ${provider.toUpperCase()} belum disetel. Isi API Key di langkah Video.`);
    (err as any).needsConfig = true;
    throw err;
  }

  const report = progressReporter(jobId);
  const ytdlpPath = YTDLP_PATH;
  const ffmpegPath = FFMPEG_PATH;

  // Preset "mau video apa dulu" menimpa default bila dikirim eksplisit.
  let effTargetDuration: string = targetDuration;
  let effMinDuration: number = minDuration;
  let effMaxDuration: number = maxDuration;
  let effMaxMoments: number = maxMoments;
  let effMatchMode: boolean = matchMode === true;
  let effDetectGames: boolean = detectGames === true;
  if (typeof preset === 'string' && preset) {
    const p = resolvePreset(preset);
    effMatchMode = p.matchMode;
    effDetectGames = p.detectGames;
    effMinDuration = p.minDuration;
    effMaxDuration = p.maxDuration;
    if (p.id === 'mlbb' || p.id === 'mlbb-vertical') effTargetDuration = 'warfull';
    else effTargetDuration = p.targetDuration;
    if (!Number.isFinite(Number(maxMoments)) || Number(maxMoments) === 10) effMaxMoments = p.maxMomentsDefault;
  }

  if (forceRefresh === true) {
    clearVideoCache(youtubeUrl);
  }

  const videoCacheDir = getVideoCacheDir(youtubeUrl);
  const cachedCompressedAudio = path.join(videoCacheDir, 'compressed.mp3');
  const cachedAnalysisVideo = path.join(videoCacheDir, 'analysis.mp4');
  const cachedTitleFile = path.join(videoCacheDir, 'title.txt');

  const tmpDir = tmp.dirSync({ unsafeCleanup: true });

  try {
    updateJob(jobId, { status: 'running' });

    // 0. Check YouTube subtitles (instant 0 API cost if available)
    const cachedTranscriptFile = path.join(videoCacheDir, 'transcript.json');
    if (!fs.existsSync(cachedTranscriptFile)) {
      report(8, 'Memeriksa ketersediaan subtitle YouTube...');
      try {
        const ytSubs = await tryFetchYouTubeSubtitles(youtubeUrl, ytdlpPath, tmpDir.name);
        if (ytSubs) {
          fs.writeFileSync(cachedTranscriptFile, JSON.stringify(ytSubs, null, 2), 'utf-8');
          console.log(`[Auto-detect] YouTube subtitles extracted (${ytSubs.segments.length} segments).`);
          report(35, 'Subtitle YouTube ditemukan (tanpa kuota Whisper)...');
        }
      } catch (e) {
        console.warn('[Auto-detect] Subtitle check skipped:', e);
      }
    }

    // 1. Download audio only or load from persistent cache
    const compressedAudio = cachedCompressedAudio;
    if (fs.existsSync(cachedCompressedAudio) && fs.statSync(cachedCompressedAudio).size > 1024) {
      console.log(`[Auto-detect] Reusing cached compressed audio: ${cachedCompressedAudio}`);
      report(45, 'Audio sudah tersedia di cache (download dilewati)...');
    } else {
      report(10, 'Mengunduh audio video untuk AI...');
      const rawAudio = path.join(tmpDir.name, 'audio.mp3');
      const ytArgs = [
        '-x',
        '--audio-format', 'mp3',
        '--ffmpeg-location', ffmpegPath,
        '--newline',
        '-o', rawAudio,
        youtubeUrl,
      ];

      await spawnProcess(ytdlpPath, ytArgs, (line: string) => {
        const match = line.match(/\[download\]\s+([\d.]+)%/);
        if (match) {
          const p = parseFloat(match[1]);
          report(Math.round(10 + (p * 0.3)), `Mengunduh audio (${Math.round(p)}%)...`);
        }
      });

      const downloadedAudioFiles = fs.readdirSync(tmpDir.name);
      const downloadedMp3 = downloadedAudioFiles.find((f: string) => f.endsWith('.mp3')) || 'audio.mp3';
      const downloadedAudioPath = path.join(tmpDir.name, downloadedMp3);

      report(42, 'Mengoptimalkan ukuran audio untuk Speech AI...');
      try {
        await runCmd(`"${ffmpegPath}" -y -i "${downloadedAudioPath}" -ar 16000 -ac 1 -b:a 24k "${cachedCompressedAudio}"`);
      } catch {
        fs.copyFileSync(downloadedAudioPath, cachedCompressedAudio);
      }
    }

    report(48, 'Mentranskripsi audio dengan Speech AI (Whisper)...');

    // 2. Transcribe audio with Whisper (with auto chunking, resume & caching)
    const transcriptData = await aiService.transcribeAudio(
      compressedAudio,
      apiKey,
      provider,
      ffmpegPath,
      videoCacheDir,
      (p) => {
        const currentPct = Math.min(70, Math.round(48 + (p.current / p.total) * 22));
        report(currentPct, p.stage);
      }
    );

    // 2.5 Low-res video for streamer facial-reaction analysis (cached if available)
    let reactionVideoPath: string | null = null;
    if (fs.existsSync(cachedAnalysisVideo) && fs.statSync(cachedAnalysisVideo).size > 10240) {
      console.log(`[Auto-detect] Reusing cached analysis video: ${cachedAnalysisVideo}`);
      report(74, 'Video analisis ditemukan di cache (download dilewati)...');
      reactionVideoPath = cachedAnalysisVideo;
    } else {
      try {
        report(72, 'Mengunduh video resolusi rendah untuk analisis ekspresi...');
        await spawnProcess(ytdlpPath, [
          '-f', 'bestvideo[height<=480]+bestaudio/best[height<=480]/best',
          '--merge-output-format', 'mp4',
          '--ffmpeg-location', ffmpegPath,
          '--no-playlist',
          '--newline',
          '-o', cachedAnalysisVideo,
          youtubeUrl,
        ], (line: string) => {
          const match = line.match(/\[download\]\s+([\d.]+)%/);
          if (match) {
            const p = parseFloat(match[1]);
            report(Math.round(60 + (p * 0.12)), `Mengunduh video analisis (${Math.round(p)}%)...`);
          }
        });
        if (fs.existsSync(cachedAnalysisVideo)) reactionVideoPath = cachedAnalysisVideo;
      } catch (vidErr) {
        console.warn('[Auto-detect] Analysis video download failed, face signal disabled:', (vidErr as Error).message || vidErr);
      }
    }

    report(75, 'AI menganalisis hook dan momen terbaik...');

    // 3. Detect viral moments (face reaction + acoustic peaks + two-pass rank)
    const moments: ScoredMoment[] = await aiService.detectViralMoments(transcriptData, apiKey, provider, effTargetDuration, effMinDuration, effMaxDuration, (p: { percent: number; stage: string }) => {
      report(75 + Math.round((p.percent || 0) * 0.2), p.stage || 'AI menganalisis hook dan momen terbaik...');
    }, { audioPath: compressedAudio, ffmpegPath, reactionVideoPath, maxMoments: effMaxMoments, matchMode: effMatchMode });

    // 3b. Game-break detection (opsional, untuk VOD turnamen pecah per game)
    let gameBreaks: GameBreak[] = [];
    if (effDetectGames === true) {
      try {
        report(96, 'Mendeteksi batas antar game...');
        gameBreaks = await aiService.detectGameBreaks(transcriptData.segments || [], compressedAudio, ffmpegPath);
        console.log(`[Auto-detect] Game breaks: ${gameBreaks.length}`);
      } catch (gbErr) {
        console.warn('[Auto-detect] Game-break detection failed:', (gbErr as Error).message || gbErr);
      }
    }

    // Get video title (cached if available)
    let videoTitle = 'Video';
    if (fs.existsSync(cachedTitleFile)) {
      videoTitle = fs.readFileSync(cachedTitleFile, 'utf-8').trim();
    } else {
      try {
        const { stdout } = await runCmd(`"${ytdlpPath}" --get-title "${youtubeUrl}"`);
        videoTitle = stdout.trim();
        if (videoTitle) fs.writeFileSync(cachedTitleFile, videoTitle, 'utf-8');
      } catch { /* ignore */ }
    }

    tmpDir.removeCallback();

    const result: DetectTaskResult = {
      videoTitle,
      moments,
      gameBreaks,
      transcript: transcriptData.text || '',
      transcriptSegments: transcriptData.segments || [],
    };
    updateJob(jobId, { status: 'done', percent: 100, stage: 'Analisis selesai!', result });
    return result;
  } catch (err) {
    console.error('Auto-detect error:', err);
    tmpDir.removeCallback();
    updateJob(jobId, { status: 'error', error: (err as Error).message || 'Gagal menganalisis video dengan AI' });
    throw err;
  }
}

// ── POST /api/auto-detect — antrekan analisis, langsung balas jobId ──
autoDetectRouter.post('/api/auto-detect', (req: Request, res: Response) => {
  const { youtubeUrl } = req.body;
  if (!youtubeUrl) return res.status(400).json({ error: 'YouTube URL wajib diisi' });
  const job = createJob('detect', 'Analisis momen video');
  void runDetectTask(job.id, req.body as DetectTaskParams).catch(() => { /* status sudah error */ });
  res.json({ jobId: job.id });
});
