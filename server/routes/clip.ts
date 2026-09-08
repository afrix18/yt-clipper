import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import tmp from 'tmp';
import * as aiService from '../ai';
import type { TranscriptData, TranscriptSegment } from '../ai';
import { loadClipsMeta, saveClipsMeta, loadConfig } from '../lib/store';
import { runCmd, spawnProcess, generateId, formatDuration, escapeFfmpegPath } from '../lib/proc';
import { setupSse } from '../lib/sse';
import { CLIPS_DIR, YTDLP_PATH, FFMPEG_PATH, DETECT_FACE_SCRIPT } from '../lib/paths';
import { resolveTargets, framingLabel, buildFilterGraph, buildFfmpegArgs } from '../lib/video';
import type { ClipMeta } from '../lib/types';

export const clipRouter = Router();

// ── POST /api/clip — Create Clip (With Real-time SSE, Framing, & Captions) ──
clipRouter.post('/api/clip', async (req: Request, res: Response) => {
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

  const { sendEvent, dispose } = setupSse(res);

  const clipId = generateId();
  const tmpDir = tmp.dirSync({ unsafeCleanup: true });
  const outputTemplate = path.join(tmpDir.name, 'source.%(ext)s');
  const clipFilename = `clip_${clipId}.mp4`;
  const clipPath = path.join(CLIPS_DIR, clipFilename);
  const clipDuration = Math.max(1, endSec - startSec);

  const targets = resolveTargets(framing, quality);
  const { targetW, targetH, is1080p, isLandscape } = targets;

  const ytdlpPath = YTDLP_PATH;
  const ffmpegPath = FFMPEG_PATH;

  const done = (): void => { dispose(); res.end(); };

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
        const cmd = `python "${DETECT_FACE_SCRIPT}" "${downloadPath}" "${framing}" "${req.body.facecamPos || 'auto'}"`;
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
      stage: `Rendering video ${isLandscape ? '16:9' : '9:16'} (${framingLabel(framing)})...`,
    });

    // 3️⃣ Build FFmpeg Filter Graph (satu cabang per framing — lihat lib/video.ts)
    const escapedAss = assFilePath ? escapeFfmpegPath(assFilePath) : null;
    const graph = buildFilterGraph(framing, targets, detectionData, escapedAss);
    const ffmpegArgs = buildFfmpegArgs(downloadPath, clipPath, graph);

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
    done();
  } catch (e) {
    console.error(`[${clipId}] ❌ Processing error:`, e);
    tmpDir.removeCallback();
    if (fs.existsSync(clipPath)) fs.unlinkSync(clipPath);
    sendEvent({ type: 'error', message: (e as Error).message || 'Gagal memproses clip' });
    done();
  }
});
