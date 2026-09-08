import * as fs from 'fs';
import { CLIPS_META, CONFIG_FILE } from './paths';
import type { ClipMeta, ServerConfig } from './types';

export function loadClipsMeta(): ClipMeta[] {
  if (!fs.existsSync(CLIPS_META)) return [];
  try { return JSON.parse(fs.readFileSync(CLIPS_META, 'utf-8')) as ClipMeta[]; }
  catch { return []; }
}

export function saveClipsMeta(clips: ClipMeta[]): void {
  fs.writeFileSync(CLIPS_META, JSON.stringify(clips, null, 2));
}

const DEFAULT_CONFIG: ServerConfig = { provider: 'groq', groqApiKey: '', openaiApiKey: '' };

export function loadConfig(): ServerConfig {
  if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as ServerConfig; }
  catch { return { ...DEFAULT_CONFIG }; }
}

export function saveConfig(cfg: ServerConfig): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

export function resolveApiKey(
  provider: string,
  reqGroqKey?: string,
  reqOpenaiKey?: string,
): { provider: string; apiKey: string } {
  const config = loadConfig();
  const active = provider || config.provider || 'groq';
  const apiKey = active === 'openai'
    ? (reqOpenaiKey || config.openaiApiKey)
    : (reqGroqKey || config.groqApiKey);
  return { provider: active, apiKey };
}
