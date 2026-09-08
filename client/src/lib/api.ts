import type { Platform } from '../types';

declare const chrome: any;

export const API = 'http://localhost:3002';

export const PENDING_KEY = 'yt_clipper_pending_upload';

export const PLATFORMS: { key: Platform; name: string; icon: string; desc: string; color: string; url: string }[] = [
  { key: 'youtube', name: 'YouTube Shorts', icon: '🎬', desc: 'Upload di YouTube Studio', color: '#ff0000', url: 'https://studio.youtube.com/channel/UC/videos/upload' },
  { key: 'tiktok', name: 'TikTok', icon: '🎵', desc: 'Upload di Creator Center', color: '#00f2ea', url: 'https://www.tiktok.com/creator#/upload?scene=creator_center' },
  { key: 'facebook', name: 'Facebook Reels', icon: '📘', desc: 'Buat Reel baru', color: '#1877f2', url: 'https://www.facebook.com/reels/create' },
  { key: 'instagram', name: 'Instagram Reels', icon: '📸', desc: 'Upload via web/app', color: '#e4405f', url: 'https://www.instagram.com/' },
];

export const STUDIO_UPLOAD_URL = 'https://studio.youtube.com/channel/UC/videos/upload?d=pt';

export type SseEvent =
  | { type: 'progress'; percent: number; stage: string }
  | { type: 'done'; [key: string]: any }
  | { type: 'error'; message: string }
  | { type: string; [key: string]: any };

// POST SSE generik: stream event `data:` sampai selesai.
// Melempar Error saat event error / respons non-OK.
export async function postSse(path: string, body: unknown, onEvent: (e: SseEvent) => void): Promise<void> {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({} as any));
    const err = new Error(errData.error || 'Gagal memproses permintaan di server');
    (err as any).needsConfig = errData.needsConfig;
    throw err;
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  if (!reader) return;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (const chunk of parts) {
      const trimmed = chunk.trim();
      if (!trimmed.startsWith('data: ')) continue;
      try {
        const event = JSON.parse(trimmed.slice(6)) as SseEvent;
        if (event.type === 'error') throw new Error(event.message);
        onEvent(event);
      } catch (parseErr: any) {
        if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
      }
    }
  }
}

export function isBackendOfflineError(msg: string): boolean {
  return /failed to fetch|network error|networkerror|econnrefused/i.test(msg || '');
}

export const BACKEND_OFFLINE_MSG = 'Koneksi ke backend (port 3002) terputus. Pastikan server backend sedang berjalan.';
