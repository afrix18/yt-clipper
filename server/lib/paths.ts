import * as path from 'path';
import * as fs from 'fs';

// Kode berjalan dari dua lokasi berbeda:
// - dev (tsx): server/lib/paths.ts  → root adalah server/
// - build (tsc): server/dist/lib/paths.js → root adalah server/
// Cari ke atas sampai ketemu package.json milik clipper-server.
function findServerDir(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')) as { name?: string };
      if (pkg && pkg.name === 'clipper-server') return dir;
    } catch { /* naik satu level */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

// NOTE: semua path runtime (clips, config, binary, script python) mengacu ke server/.
export const SERVER_DIR = findServerDir(__dirname);
export const CLIPS_DIR = path.join(SERVER_DIR, 'clips');
export const CLIPS_META = path.join(SERVER_DIR, 'clips.json');
export const CONFIG_FILE = path.join(SERVER_DIR, 'config.json');
export const YTDLP_PATH = path.join(SERVER_DIR, 'yt-dlp.exe');
export const FFMPEG_PATH = path.join(SERVER_DIR, 'ffmpeg.exe');
export const DETECT_FACE_SCRIPT = path.join(SERVER_DIR, 'detect_face.py');
export const CACHE_DIR = path.join(SERVER_DIR, 'cache');

if (!fs.existsSync(CLIPS_DIR)) fs.mkdirSync(CLIPS_DIR, { recursive: true });
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
