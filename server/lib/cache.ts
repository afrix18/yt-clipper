import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { CACHE_DIR } from './paths';

export function getVideoCacheKey(url: string): string {
  const match = url.match(/(?:v=|youtu\.be\/|\/shorts\/|\/live\/)([a-zA-Z0-9_-]{11})/);
  if (match) return match[1];
  return crypto.createHash('sha256').update(url.trim()).digest('hex').slice(0, 16);
}

export function getVideoCacheDir(url: string): string {
  const key = getVideoCacheKey(url);
  const dir = path.join(CACHE_DIR, key);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function clearVideoCache(url: string): void {
  const key = getVideoCacheKey(url);
  const dir = path.join(CACHE_DIR, key);
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`[Cache] Failed to delete cache for ${key}:`, e);
    }
  }
}
