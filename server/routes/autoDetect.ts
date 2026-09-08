import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import tmp from 'tmp';
import * as aiService from '../ai';
import type { GameBreak, ScoredMoment } from '../ai';
import { loadConfig } from '../lib/store';
import { runCmd, spawnProcess } from '../lib/proc';
import { setupSse } from '../lib/sse';
import { YTDLP_PATH, FFMPEG_PATH } from '../lib/paths';

export const autoDetectRouter = Router();

// ── POST /api/auto-detect — Detect Viral Moments with AI ─────────────
autoDetectRouter.post('/api/auto-detect', async (req: Request, res: Response) => {
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
  const apiKey = provider === 'openai'
    ? (reqOpenaiKey || config.openaiApiKey)
    : (reqGroqKey || config.groqApiKey);

  if (!apiKey) {
    return res.status(400).json({
      error: `API Key ${provider.toUpperCase()} belum disetel. Buka menu Settings ⚙️ untuk memasukkan API Key.`,
      needsConfig: true,
    });
  }

  const { sendEvent, dispose } = setupSse(res);
  const ytdlpPath = YTDLP_PATH;
  const ffmpegPath = FFMPEG_PATH;

  const tmpDir = tmp.dirSync({ unsafeCleanup: true });
  const audioFile = path.join(tmpDir.name, 'audio.mp3');

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

    await spawnProcess(ytdlpPath, ytArgs, (line: string) => {
      const match = line.match(/\[download\]\s+([\d.]+)%/);
      if (match) {
        const p = parseFloat(match[1]);
        sendEvent({ type: 'progress', percent: Math.round(10 + (p * 0.3)), stage: `Mengunduh audio (${Math.round(p)}%)...` });
      }
    });

    const downloadedAudioFiles = fs.readdirSync(tmpDir.name);
    const downloadedMp3 = downloadedAudioFiles.find((f: string) => f.endsWith('.mp3')) || 'audio.mp3';
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
    let reactionVideoPath: string | null = null;
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
      ], (line: string) => {
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
    dispose();
    res.end();
  } catch (err) {
    console.error('Auto-detect error:', err);
    tmpDir.removeCallback();
    sendEvent({ type: 'error', message: (err as Error).message || 'Gagal menganalisis video dengan AI' });
    dispose();
    res.end();
  }
});
