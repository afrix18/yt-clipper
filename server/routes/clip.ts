import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import tmp from 'tmp';
import * as aiService from '../ai';
import type { TranscriptData, TranscriptSegment } from '../ai';
import { loadClipsMeta, saveClipsMeta, loadConfig } from '../lib/store';
import { runCmd, spawnProcess, generateId, formatDuration, escapeFfmpegPath } from '../lib/proc';
import { CLIPS_DIR, YTDLP_PATH, FFMPEG_PATH, DETECT_FACE_SCRIPT } from '../lib/paths';
import { resolveTargets, framingLabel, buildFilterGraph, buildFfmpegArgs } from '../lib/video';
import { createJob, updateJob, progressReporter } from '../lib/jobs';
import type { ClipMeta } from '../lib/types';

export const clipRouter = Router();

export interface ClipTaskParams {
  youtubeUrl: string;
  startSec: number;
  endSec: number;
  framing?: string;
  facecamPos?: string;
  quality?: string;
  burnCaptions?: boolean;
  captionPos?: string;
  customTitle?: string;
  transcriptSegments?: TranscriptSegment[] | null;
  provider?: string;
  groqApiKey?: string;
  openaiApiKey?: string;
}

// ── Worker: seluruh pipeline render berjalan di background server.
// Panel boleh ditutup kapan pun — progres tersimpan di job store.
export async function runClipTask(jobId: string, p: ClipTaskParams): Promise<ClipMeta> {
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
  } = p;

  const report = progressReporter(jobId);
  const clipId = generateId();
  const tmpDir = tmp.dirSync({ unsafeCleanup: true });
  const outputTemplate = path.join(tmpDir.name, 'source.%(ext)s');
  const clipFilename = `clip_${clipId}.mp4`;
  const clipPath = path.join(CLIPS_DIR, clipFilename);
  const clipDuration = Math.max(1, endSec - startSec);

  const targets = resolveTargets(framing, quality);
  const { targetW, targetH, is1080p } = targets;

  const ytdlpPath = YTDLP_PATH;
  const ffmpegPath = FFMPEG_PATH;

  try {
    updateJob(jobId, { status: 'running' });
    report(10, 'Mempersiapkan potongan video...');

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
        report(Math.min(45, overall), `Mengunduh potongan video (${Math.round(dlPercent)}%)...`);
        return;
      }
      const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2}\.?\d*)/);
      if (timeMatch) {
        const sec = parseInt(timeMatch[1], 10) * 3600 + parseInt(timeMatch[2], 10) * 60 + parseFloat(timeMatch[3]);
        const fraction = Math.min(1, Math.max(0, sec / clipDuration));
        const overall = Math.round(10 + (fraction * 35));
        report(Math.min(45, overall), `Mengunduh potongan durasi (${Math.round(fraction * 100)}%)...`);
      }
    };

    try {
      await spawnProcess(ytdlpPath, ytArgs, handleProgressLine, handleProgressLine);
    } catch (dlErr) {
      console.log(`[${clipId}] Fallback format...`, (dlErr as Error).message);
      report(15, 'Mengunduh format fallback...');
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

    report(50, 'Potongan video siap...');

    // Locate downloaded source
    const downloadedFiles = fs.readdirSync(tmpDir.name);
    const mergedFile = downloadedFiles.find((f: string) => f.endsWith('.mp4'));
    if (!mergedFile) throw new Error('MP4 file tidak ditemukan setelah download');
    const downloadPath = path.join(tmpDir.name, mergedFile);

    // 2️⃣ Generate Subtitle if Burn Captions is ON
    let assFilePath: string | null = null;
    let clipTranscriptText = '';

    if (burnCaptions) {
      report(55, 'Menyiapkan caption teks presisi...');

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
          report(57, 'Sinkronisasi suara dan kata (Speech AI)...');
          transcriptData = await aiService.transcribeAudio(clipAudio, apiKey, provider, ffmpegPath);
          clipTranscriptText = transcriptData.text || '';
          console.log(`[${clipId}] Direct clip audio transcribed: ${transcriptData.words?.length || 0} words`);
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
        const assContent = aiService.generateAssSubtitle(transcriptData, effectiveStartSec, endSec, is1080p, captionPos, framing);
        assFilePath = path.join(tmpDir.name, 'caption.ass');
        fs.writeFileSync(assFilePath, assContent, 'utf-8');
        console.log(`[${clipId}] ASS Subtitle generated:`, assFilePath);
      }
    }

    // 2.5️⃣ AI Face / Streamer Layout Detection (dilewati untuk mlbb/landscape: clean broadcast)
    let detectionData: any = null;
    if (framing === 'smart' || framing === 'streamer') {
      report(60, framing === 'streamer'
        ? 'AI mendeteksi posisi facecam streamer...'
        : 'AI mendeteksi posisi wajah dan pembicara...');

      try {
        const cmd = `python "${DETECT_FACE_SCRIPT}" "${downloadPath}" "${framing}" "${facecamPos}"`;
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
          console.log(`[${clipId}] AI Detection success:`, {
            detected: detectionData.detected,
            corner: detectionData.detectedCorner,
            smartX: detectionData.smartCrop?.cropX,
          });
        }
      } catch (detErr) {
        console.warn(`[${clipId}] Face detection warning:`, (detErr as Error).message || detErr);
      }
    }

    const aspectLabel = framing === 'mlbb' ? '4:3' : framing === 'landscape' ? '16:9' : '9:16';
    report(65, `Rendering video ${aspectLabel} (${framingLabel(framing)})...`);

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
        report(Math.min(92, overall), `Rendering (${Math.round(renderFraction * 100)}%)...`);
      }
    });

    report(94, 'Menganalisis skor viralitas...');

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

    console.log(`[${clipId}] Clip complete: ${clipFilename} (${clipMeta.fileSizeMB} MB, Captions: ${burnCaptions})`);

    tmpDir.removeCallback();

    updateJob(jobId, { status: 'done', percent: 100, stage: 'Clip selesai diproses!', result: { clip: clipMeta } });
    return clipMeta;
  } catch (e) {
    console.error(`[${clipId}] Processing error:`, e);
    tmpDir.removeCallback();
    if (fs.existsSync(clipPath)) fs.unlinkSync(clipPath);
    updateJob(jobId, { status: 'error', error: (e as Error).message || 'Gagal memproses clip' });
    throw e;
  }
}

// ── POST /api/clip — antrekan 1 klip, langsung balas jobId ──
clipRouter.post('/api/clip', (req: Request, res: Response) => {
  const { youtubeUrl, startSec, endSec } = req.body;
  if (!youtubeUrl || startSec == null || endSec == null) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }
  const label = req.body.customTitle
    ? String(req.body.customTitle).slice(0, 80)
    : `Klip ${startSec}s-${endSec}s`;
  const job = createJob('clip', label);
  void runClipTask(job.id, req.body as ClipTaskParams).catch(() => { /* status sudah error */ });
  res.json({ jobId: job.id });
});

// ── POST /api/clip-batch — antrekan N klip sekaligus, proses berurutan ──
clipRouter.post('/api/clip-batch', (req: Request, res: Response) => {
  const { items } = req.body as { items: ClipTaskParams[] };
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array wajib diisi' });
  }
  if (items.length > 50) {
    return res.status(400).json({ error: 'Maksimal 50 klip per batch' });
  }
  for (const it of items) {
    if (!it.youtubeUrl || it.startSec == null || it.endSec == null) {
      return res.status(400).json({ error: 'Setiap item wajib ada youtubeUrl, startSec, endSec' });
    }
  }
  const childJobs = items.map((it) =>
    createJob('clip', it.customTitle ? String(it.customTitle).slice(0, 80) : `Klip ${it.startSec}s-${it.endSec}s`));
  const batch = createJob('batch', `Batch ${items.length} klip`, childJobs.map((j) => j.id));

  void (async () => {
    updateJob(batch.id, { status: 'running', percent: 1, stage: `Memproses 1/${items.length}...` });
    for (let i = 0; i < items.length; i++) {
      try {
        await runClipTask(childJobs[i].id, items[i]);
      } catch { /* lanjut ke item berikutnya */ }
      updateJob(batch.id, {
        percent: Math.round(((i + 1) / items.length) * 100),
        stage: i + 1 >= items.length ? 'Batch selesai!' : `Memproses ${i + 2}/${items.length}...`,
      });
    }
    updateJob(batch.id, { status: 'done', percent: 100, stage: `Semua ${items.length} klip selesai!` });
  })().catch((e) => {
    updateJob(batch.id, { status: 'error', error: (e as Error).message || 'Batch gagal' });
  });

  res.json({ batchId: batch.id, jobIds: childJobs.map((j) => j.id) });
});
