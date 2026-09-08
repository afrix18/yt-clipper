// Registri job aktif di sisi client: hook apa pun bisa mendaftarkan jobId,
// banner global + polling tetap hidup walau pengguna pindah halaman.
type Listener = () => void;

const tracked = new Set<string>();
const listeners = new Set<Listener>();

function notify() {
  for (const l of [...listeners]) {
    try { l(); } catch { /* ignore */ }
  }
}

export function registerJob(id: string): void {
  if (!id) return;
  tracked.add(id);
  notify();
}

export function unregisterJob(id: string): void {
  if (tracked.delete(id)) notify();
}

export function getTrackedJobIds(): string[] {
  return [...tracked];
}

export function subscribeTracked(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
