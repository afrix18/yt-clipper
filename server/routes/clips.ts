import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import tmp from 'tmp';
import * as aiService from '../ai';
import { loadClipsMeta, saveClipsMeta, loadConfig } from '../lib/store';
import { runCmd } from '../lib/proc';
import { CLIPS_DIR, FFMPEG_PATH } from '../lib/paths';

export const clipsRouter = Router();

// ── GET /api/clips — List all clips ──────────────────────────────────
clipsRouter.get('/api/clips', (req: Request, res: Response) => {
  const clips = loadClipsMeta();
  res.json(clips);
});

// ── GET /api/clips/:id — Download clip ───────────────────────────────
clipsRouter.get('/api/clips/:id', (req: Request, res: Response) => {
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
clipsRouter.delete('/api/clips/:id', (req: Request, res: Response) => {
  const clips = loadClipsMeta();
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
clipsRouter.get('/api/clips/:id/virality', async (req: Request, res: Response) => {
  const clips = loadClipsMeta();
  const clip = clips.find(c => c.id === req.params.id);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });
  res.json(clip.virality || { total: 75, grade: 'good', scores: {}, tips: ['Clip siap diupload!'] });
});

// ── POST /api/clips/:id/transcribe ───────────────────────────────────
clipsRouter.post('/api/clips/:id/transcribe', async (req: Request, res: Response) => {
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
      const ffmpegPath = FFMPEG_PATH;
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
