import { Router, Request, Response } from 'express';
import { loadConfig, saveConfig } from '../lib/store';

export const settingsRouter = Router();

// ── GET /api/settings ─────────────────────────────────────────
settingsRouter.get('/api/settings', (req: Request, res: Response) => {
  const config = loadConfig();
  res.json({
    provider: config.provider || 'groq',
    hasGroqKey: Boolean(config.groqApiKey),
    hasOpenaiKey: Boolean(config.openaiApiKey),
    groqApiKey: config.groqApiKey ? '••••••••' + config.groqApiKey.slice(-4) : '',
    openaiApiKey: config.openaiApiKey ? '••••••••' + config.openaiApiKey.slice(-4) : '',
  });
});

// ── POST /api/settings ────────────────────────────────────────
settingsRouter.post('/api/settings', (req: Request, res: Response) => {
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
