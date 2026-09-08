import type { Response } from 'express';

export interface SseChannel {
  sendEvent: (data: unknown) => void;
  dispose: () => void;
}

// Siapkan header SSE + ping keepalive. Panggil dispose() saat selesai.
export function setupSse(res: Response): SseChannel {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders?.();

  const pingInterval = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* client gone */ }
  }, 4000);

  const onClose = (): void => clearInterval(pingInterval);
  res.on('close', onClose);

  return {
    sendEvent: (data: unknown): void => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    dispose: (): void => {
      clearInterval(pingInterval);
      res.removeListener('close', onClose);
    },
  };
}
