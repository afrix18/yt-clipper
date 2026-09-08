/**
 * Clipper - TikTok Creator Center semi-otomatisasi upload.
 *
 * Alur: panel "Platform Lain" -> tombol "Otomatisasi" TikTok menyimpan
 * payload ke chrome.storage.local lalu membuka halaman upload TikTok.
 * Script ini: mengambil file klip dari server lokal, menyuntikkannya ke
 * input upload, mengisi caption, lalu BERHENTI agar pengguna memeriksa
 * dan menekan Post sendiri (mode aman).
 */

(function () {
  console.log('[Clipper] TikTok upload helper loaded');

  const extApi: any = (globalThis as any).chrome;

  interface TikTokPayload {
    clipId?: string;
    videoUrl?: string;
    filename?: string;
    caption?: string;
    [key: string]: unknown;
  }

  const STORAGE_KEY = 'yt_clipper_tiktok_payload';

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  function status(msg: string, isError = false): void {
    console.log('[Clipper TikTok]', msg);
    let badge = document.getElementById('clipper-tiktok-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'clipper-tiktok-badge';
      badge.style.cssText = [
        'position:fixed', 'bottom:16px', 'right:16px', 'z-index:999999',
        'max-width:320px', 'padding:12px 14px', 'border-radius:12px',
        'font-family:system-ui,sans-serif', 'font-size:12px', 'line-height:1.5',
        'background:#0b0f1a', 'color:#e2e8f0', 'border:1px solid #8b5cf6',
        'box-shadow:0 8px 30px rgba(0,0,0,.5)',
      ].join(';');
      document.body.appendChild(badge);
    }
    badge.style.borderColor = isError ? '#ef4444' : '#8b5cf6';
    badge.textContent = msg;
  }

  async function readPayload(): Promise<TikTokPayload | null> {
    if (extApi && extApi.storage?.local) {
      try {
        const res: any = await extApi.storage.local.get([STORAGE_KEY]);
        return (res[STORAGE_KEY] as TikTokPayload) || null;
      } catch { return null; }
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) as TikTokPayload : null;
    } catch { return null; }
  }

  function clearPayload(): void {
    try {
      if (extApi && extApi.storage?.local) {
        extApi.storage.local.remove([STORAGE_KEY]);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch { /* ignore */ }
  }

  async function waitFor(fn: () => Element | null, timeoutMs = 15000): Promise<Element | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const el = fn();
        if (el && (el as HTMLElement).offsetParent !== null) return el;
      } catch { /* coba lagi */ }
      await sleep(400);
    }
    return null;
  }

  function setCaption(text: string): boolean {
    const sels = [
      '[data-testid="caption-editor"] [contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div.public-DraftEditor-content',
      '[placeholder*="caption" i]',
    ];
    for (const s of sels) {
      try {
        const el = document.querySelector(s) as HTMLElement | null;
        if (!el) continue;
        el.focus();
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('[Clipper TikTok] Caption filled via:', s);
        return true;
      } catch { /* selector berikutnya */ }
    }
    console.warn('[Clipper TikTok] Caption editor not found');
    return false;
  }

  async function run(): Promise<void> {
    const data = await readPayload();
    if (!data) return; // halaman dibuka manual tanpa payload: diam

    status('Mengambil file klip dari server lokal...');
    const downloadUrl = data.videoUrl || `http://localhost:3002/api/clips/${data.clipId}`;
    const filename = data.filename || 'clip.mp4';

    let file: File;
    try {
      const res = await fetch(downloadUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      file = new File([blob], filename, { type: 'video/mp4' });
    } catch (err) {
      status(`Gagal mengambil file dari server: ${(err as Error).message}. Seret file manual.`, true);
      return;
    }

    status('Menyuntikkan file ke uploader TikTok...');
    const dt = new DataTransfer();
    dt.items.add(file);

    const fileInput = await waitFor(() =>
      document.querySelector('input[type="file"][accept*="video"]') as Element | null ||
      document.querySelector('input[type="file"]') as Element | null
    , 15000) as HTMLInputElement | null;

    if (!fileInput) {
      status('Kolom upload tidak ditemukan. Seret file manual ke halaman ini.', true);
      return;
    }
    try {
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (err) {
      console.warn('[Clipper TikTok] input assign failed:', err);
    }

    // Tunggu pratinjau video muncul = upload diterima
    status('Menunggu TikTok menerima video...');
    await sleep(4000);

    if (data.caption) {
      const ok = setCaption(String(data.caption).slice(0, 2200));
      status(ok
        ? 'Video dan caption terisi. Periksa kembali lalu tekan Post sendiri.'
        : 'Video terisi, caption gagal otomatis — tempel manual lalu tekan Post.');
    } else {
      status('Video terisi. Isi caption lalu tekan Post.');
    }
    clearPayload();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void run());
  } else {
    void run();
  }
})();
