import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import tmp from 'tmp';
import * as aiService from '../ai';
import { loadClipsMeta, saveClipsMeta, loadConfig } from '../lib/store';
import { runCmd } from '../lib/proc';
import { CLIPS_DIR, YTDLP_PATH, FFMPEG_PATH } from '../lib/paths';

export const captionsRouter = Router();

interface BatchCaption {
  title: string;
  description: string;
  hashtags: string[];
}

// ── POST /api/generate-caption ──────────────────────────────────────
captionsRouter.post('/api/generate-caption', async (req: Request, res: Response) => {
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
      const ytdlpPath = YTDLP_PATH;
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
        const ffmpegPath = FFMPEG_PATH;
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
captionsRouter.post('/api/generate-captions-batch', async (req: Request, res: Response) => {
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
captionsRouter.get('/api/upload-urls/:id', (req: Request, res: Response) => {
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
