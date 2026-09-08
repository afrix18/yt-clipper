/**
 * YT Short Clipper - YouTube Studio Full Auto-Upload, Batch Queue & Scheduler Content Script
 * 
 * Automatically handles the entire YouTube Shorts upload pipeline:
 * 1. Opens the YouTube Studio upload modal if not already open
 * 2. Fetches clip video file from local server & injects via DataTransfer/input
 * 3. Fills Title (hook + emoji + #Shorts), Description, Hashtags, and Audience ("Not Made for Kids")
 * 4. Automatically navigates Next -> Next -> Next through all wizard steps
 * 5. Selects Public or Schedule (with exact Date & Time) and clicks Publish / Schedule
 * 6. Supports sequential Batch Queue: automatically advances to the next video in queue until all videos are scheduled!
 * 7. Provides an interactive floating control badge with live step tracking, queue counter & pause/resume
 */

declare const chrome: any;

(function () {
  console.log('[YT Clipper] Full Auto-Uploader & Batch Scheduler script loaded on studio.youtube.com');

  // Payload antrean upload (dibangun client → disimpan di server queue / extension storage)
  interface UploadPayload {
    clipId?: string;
    videoUrl?: string;
    filename?: string;
    title?: string;
    description?: string;
    hashtags?: string[];
    channelName?: string;
    isScheduled?: boolean;
    scheduleTime?: string | null;
    autoPublish?: boolean;
    timestamp?: number;
    queueIndex?: number;
    queueTotal?: number;
    [key: string]: unknown;
  }

  const STORAGE_KEY = 'yt_clipper_pending_upload';
  let isAutomationPaused = false;
  let currentActiveStep = 0; // 1: File, 2: Metadata, 3: Checks, 4: Publish
  let currentProcessingData: UploadPayload | null = null;

  // ── 1. Retrieve pending upload payload from backend queue ──────────────
  async function getPendingUpload(callback: (data: UploadPayload | null) => void): Promise<void> {
    // 1. Check backend server (works across all tabs, origins, & localhost ports!)
    try {
      const res = await fetch('http://localhost:3002/api/pending-upload');
      if (res.ok) {
        const json: any = await res.json();
        if (json.pending) {
          console.log('[YT Clipper] Found pending upload from backend:', json.pending.title, `(${json.queueIndex + 1}/${json.queueTotal})`);
          callback(json.pending as UploadPayload);
          return;
        }
      }
    } catch (err) {
      console.warn('[YT Clipper] Backend pending upload check failed:', (err as Error).message);
    }

    // 2. Check chrome.storage.local (if extension storage is active)
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([STORAGE_KEY], (res: any) => {
        callback((res[STORAGE_KEY] as UploadPayload) || null);
      });
      return;
    }

    // 3. Fallback to localStorage
    try {
      const item = localStorage.getItem(STORAGE_KEY);
      callback(item ? JSON.parse(item) : null);
    } catch {
      callback(null);
    }
  }

  function clearPendingUpload() {
    try {
      fetch('http://localhost:3002/api/pending-upload', { method: 'DELETE' });
    } catch {}

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove([STORAGE_KEY]);
    } else {
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
    }
  }

  // ── 2. Utility DOM & Event Helpers ─────────────────────────────────────
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  function safeClick(el: Element | null): boolean {
    if (!el) return false;
    const target = el.querySelector('button, tp-yt-paper-button, [role="button"]') || el;
    (target as HTMLElement).focus?.();
    const opts = { bubbles: true, cancelable: true, view: window };
    target.dispatchEvent(new PointerEvent('pointerdown', opts));
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    target.dispatchEvent(new PointerEvent('pointerup', opts));
    target.dispatchEvent(new MouseEvent('mouseup', opts));
    (target as HTMLElement).click?.();
    return true;
  }

  function setElementText(el: Element | null, text: string): boolean {
    if (!el) return false;
    const htmlEl = el as HTMLElement;
    htmlEl.focus();
    if (htmlEl.isContentEditable) {
      try {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(htmlEl);
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.execCommand('delete', false);
        document.execCommand('insertText', false, text);
      } catch {
        htmlEl.innerText = text;
      }
      htmlEl.dispatchEvent(new Event('input', { bubbles: true }));
      htmlEl.dispatchEvent(new Event('change', { bubbles: true }));
      htmlEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
    } else {
      (htmlEl as HTMLInputElement).value = text;
      htmlEl.dispatchEvent(new Event('input', { bubbles: true }));
      htmlEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
    htmlEl.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  async function waitForElement(selectorFn: () => Element | null, timeoutMs = 20000, intervalMs = 300): Promise<Element | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = typeof selectorFn === 'function' ? selectorFn() : document.querySelector(selectorFn);
      if (el && ((el as HTMLElement).offsetParent !== null || el.getBoundingClientRect().width > 0 || el.tagName === 'INPUT')) {
        return el;
      }
      await sleep(intervalMs);
    }
    return null;
  }

  // ── Isi jam tayang Studio dari string lokal "YYYY-MM-DDTHH:mm" ──
  // Mengembalikan true bila nilai terverifikasi terbaca kembali di input.
  // Tidak memakai `new Date()` agar tidak ada konversi zona waktu.
  async function setStudioScheduleTime(localStr: string): Promise<boolean> {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(localStr || ''));
    if (!m) {
      console.warn('[YT Clipper] Invalid scheduleTime format:', localStr);
      return false;
    }
    const hh = parseInt(m[4], 10);
    const mm = m[5];
    const candidates = [
      `${hh.toString().padStart(2, '0')}:${mm}`,              // 24 jam: "18:00"
      `${hh % 12 || 12}:${mm} ${hh >= 12 ? 'PM' : 'AM'}`,     // 12 jam: "6:00 PM"
    ];

    const findTimeInput = (): HTMLInputElement | null => {
      const sels = [
        'ytcp-time-of-day-picker input',
        '#time-of-day-trigger input',
        'ytcp-scheduling-picker input',
        'input[aria-label*="time" i]',
        'input[aria-label*="waktu" i]',
        'input[aria-label*="jam" i]',
        'input[placeholder*=":"]',
      ];
      for (const s of sels) {
        try {
          const el = document.querySelector(s) as HTMLInputElement | null;
          if (el && el.offsetParent !== null) return el;
        } catch { /* selector tidak valid di browser ini */ }
      }
      return null;
    };

    // Dialog jadwal Studio kadang butuh dibuka/difokuskan dulu.
    const trigger = document.querySelector('#datepicker-trigger, #date-picker-trigger, ytcp-datepicker-trigger') as HTMLElement | null;
    if (trigger) {
      try { safeClick(trigger); await sleep(600); } catch { /* abaikan */ }
    }

    const input = await waitForElement(() => findTimeInput(), 8000);
    if (!input) {
      console.warn('[YT Clipper] Time input not found. Tried selectors for ytcp-time-of-day-picker.');
      return false;
    }
    console.log('[YT Clipper] Time input found:', input.outerHTML.slice(0, 160));

    for (const text of candidates) {
      try {
        (input as HTMLElement).focus();
        (input as HTMLInputElement).click?.();
        await sleep(200);
        // Hapus total lalu ketik ulang (lebih andal untuk input Polymer).
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
        await sleep(500);
        input.dispatchEvent(new Event('blur', { bubbles: true }));
        await sleep(300);
        const back = ((input as HTMLInputElement).value || '').trim();
        console.log(`[YT Clipper] Tried "${text}", input now reads "${back}"`);
        if (back.includes(`${hh.toString().padStart(2, '0')}:${mm}`) || back.includes(`${hh % 12 || 12}:${mm}`)) {
          return true;
        }
      } catch (tErr) {
        console.warn('[YT Clipper] Time fill attempt failed:', tErr);
      }
    }
    return false;
  }

  function formatScheduleDisplay(isoStr: string | null | undefined): string {    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch {
      return isoStr;
    }
  }

  // ── 3. Interactive Floating Assistant Badge ────────────────────────────
  function createFloatingBadge(data: UploadPayload): void {
    currentProcessingData = data;
    let badge = document.getElementById('yt-clipper-helper-badge');

    const channelTag = data.channelName ? ` #${data.channelName.replace(/\s+/g, '')}` : '';
    const isBatch = data.queueTotal && data.queueTotal > 1;
    const batchHeader = isBatch
      ? `<div style="display:inline-block; font-size:10px; background:#8b5cf6; color:#fff; border-radius:4px; padding:2px 6px; font-weight:700; margin-left:6px;">Antrean [${(data.queueIndex || 0) + 1}/${data.queueTotal}]</div>`
      : '';

    const scheduleInfo = (data.isScheduled && data.scheduleTime)
      ? `<div style="font-size:11px; color:#38bdf8; margin-top:3px;">🕒 Target Jadwal: <strong>${formatScheduleDisplay(data.scheduleTime)}</strong></div>`
      : '';

    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'yt-clipper-helper-badge';
      badge.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 999999999;
        background: #121217;
        color: #f4f4f5;
        border: 1.5px solid #8b5cf6;
        border-radius: 14px;
        padding: 16px 20px;
        box-shadow: 0 12px 35px rgba(0,0,0,0.8), 0 0 25px rgba(139,92,246,0.4);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        font-size: 13px;
        width: 370px;
        box-sizing: border-box;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      `;
      document.body.appendChild(badge);
    }

    badge.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#22c55e; box-shadow:0 0 8px #22c55e;" id="yt-clipper-dot"></span>
          <span style="font-weight:700; color:#c084fc; font-size:13.5px; letter-spacing:0.3px;">
            ⚡ Auto-Upload & Scheduler
          </span>
          ${batchHeader}
        </div>
        <button id="yt-clipper-close" style="background:none; border:none; color:#a1a1aa; cursor:pointer; font-size:18px; line-height:1; padding:2px 6px;">×</button>
      </div>

      <div style="font-size:12px; color:#e4e4e7; margin-bottom:10px; line-height:1.4; background:rgba(255,255,255,0.04); padding:8px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.08);">
        <div style="font-weight:600; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" id="yt-badge-clip-title" title="${data.title || 'Clip Video'}">
          🎬 ${data.title || 'Clip Video'}
        </div>
        ${channelTag ? `<div style="font-size:11px; color:#a78bfa; margin-top:3px;">Kreator: <strong>${data.channelName}</strong></div>` : ''}
        ${scheduleInfo}
      </div>

      <!-- Stepper Indicator -->
      <div style="display:flex; justify-content:space-between; margin-bottom:12px; gap:4px; font-size:10.5px; font-weight:600;">
        <div id="yt-step-1" style="flex:1; text-align:center; padding:5px 2px; border-radius:6px; background:#8b5cf6; color:#fff; transition:all 0.3s;">
          1. File 📤
        </div>
        <div id="yt-step-2" style="flex:1; text-align:center; padding:5px 2px; border-radius:6px; background:rgba(255,255,255,0.08); color:#a1a1aa; transition:all 0.3s;">
          2. Detail 📝
        </div>
        <div id="yt-step-3" style="flex:1; text-align:center; padding:5px 2px; border-radius:6px; background:rgba(255,255,255,0.08); color:#a1a1aa; transition:all 0.3s;">
          3. Cek 🛡️
        </div>
        <div id="yt-step-4" style="flex:1; text-align:center; padding:5px 2px; border-radius:6px; background:rgba(255,255,255,0.08); color:#a1a1aa; transition:all 0.3s;">
          4. ${data.isScheduled ? 'Jadwal 🕒' : 'Terbit 🚀'}
        </div>
      </div>

      <!-- Realtime Status Message -->
      <div id="yt-clipper-status" style="
        font-size:11.5px;
        color:#f3f4f6;
        min-height:36px;
        display:flex;
        align-items:center;
        justify-content:center;
        text-align:center;
        background:rgba(139, 92, 246, 0.12);
        border:1px solid rgba(139, 92, 246, 0.25);
        padding:8px 10px;
        border-radius:8px;
        margin-bottom:10px;
        line-height:1.35;
      ">
        Memulai upload otomatis...
      </div>

      <!-- Action & Pause Buttons -->
      <div style="display:flex; gap:8px;">
        <button id="yt-clipper-pause-btn" style="
          flex:1;
          background: rgba(255,255,255,0.1);
          color:#e4e4e7;
          border:1px solid rgba(255,255,255,0.15);
          border-radius:6px;
          padding:7px 10px;
          font-weight:600;
          font-size:11.5px;
          cursor:pointer;
          display:flex;
          align-items:center;
          justify-content:center;
          gap:4px;
          transition:all 0.2s;
        ">
          ⏸️ Jeda Auto-Next
        </button>

        <button id="yt-clipper-trigger-btn" style="
          flex:1;
          background: #8b5cf6;
          color:#fff;
          border:none;
          border-radius:6px;
          padding:7px 10px;
          font-weight:600;
          font-size:11.5px;
          cursor:pointer;
          display:flex;
          align-items:center;
          justify-content:center;
          gap:4px;
          transition:all 0.2s;
        ">
          ⚡ Jalankan Sekarang
        </button>
      </div>

      <div id="yt-clipper-url-container" style="display:none; margin-top:10px; text-align:center;">
        <a id="yt-clipper-url-link" href="#" target="_blank" style="
          color:#38bdf8;
          font-size:12px;
          text-decoration:none;
          font-weight:600;
          display:inline-flex;
          align-items:center;
          gap:4px;
        ">
          🔗 Buka Video Short &rarr;
        </a>
      </div>
    `;

    // Event listeners for badge
    document.getElementById('yt-clipper-close')?.addEventListener('click', () => {
      badge.remove();
    });

    const pauseBtn = document.getElementById('yt-clipper-pause-btn');
    pauseBtn?.addEventListener('click', () => {
      isAutomationPaused = !isAutomationPaused;
      if (isAutomationPaused) {
        pauseBtn.innerHTML = '▶️ Lanjutkan Auto-Next';
        pauseBtn.style.background = '#eab308';
        pauseBtn.style.color = '#000';
        updateBadgeStatus('⏸️ Auto-Next dijeda. Anda dapat memeriksa form lalu klik Lanjutkan.');
      } else {
        pauseBtn.innerHTML = '⏸️ Jeda Auto-Next';
        pauseBtn.style.background = 'rgba(255,255,255,0.1)';
        pauseBtn.style.color = '#e4e4e7';
        updateBadgeStatus('▶️ Auto-Next dilanjutkan!');
      }
    });

    document.getElementById('yt-clipper-trigger-btn')?.addEventListener('click', () => {
      runFullAutoUploadWorkflow(currentProcessingData || data);
    });
  }

  function updateStepperUI(step: number): void {
    currentActiveStep = step;
    for (let i = 1; i <= 4; i++) {
      const el = document.getElementById(`yt-step-${i}`);
      if (!el) continue;
      if (i < step) {
        el.style.background = '#10b981'; // done green
        el.style.color = '#fff';
      } else if (i === step) {
        el.style.background = '#8b5cf6'; // current purple
        el.style.color = '#fff';
        el.style.boxShadow = '0 0 10px rgba(139,92,246,0.6)';
      } else {
        el.style.background = 'rgba(255,255,255,0.08)'; // pending gray
        el.style.color = '#a1a1aa';
        el.style.boxShadow = 'none';
      }
    }
  }

  function updateBadgeStatus(msg: string, isSuccess = false, isError = false): void {
    const statusEl = document.getElementById('yt-clipper-status');
    const dot = document.getElementById('yt-clipper-dot');
    if (statusEl) {
      statusEl.innerHTML = msg;
      if (isSuccess) {
        statusEl.style.color = '#4ade80';
        statusEl.style.borderColor = 'rgba(34, 197, 94, 0.4)';
        statusEl.style.background = 'rgba(34, 197, 94, 0.12)';
        if (dot) dot.style.background = '#22c55e';
      } else if (isError) {
        statusEl.style.color = '#f87171';
        statusEl.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        statusEl.style.background = 'rgba(239, 68, 68, 0.12)';
        if (dot) dot.style.background = '#ef4444';
      } else {
        statusEl.style.color = '#f3f4f6';
        statusEl.style.borderColor = 'rgba(139, 92, 246, 0.25)';
        statusEl.style.background = 'rgba(139, 92, 246, 0.12)';
        if (dot) dot.style.background = '#a855f7';
      }
    }
  }

  // ── 4. Main Automated Workflow ─────────────────────────────────────────

  async function openUploadDialogIfNeeded(): Promise<boolean> {
    // Check if dialog is already open
    const existingDialog = document.querySelector('ytcp-uploads-dialog, ytcp-video-upload-dialog');
    if (existingDialog && (existingDialog as HTMLElement).offsetParent !== null) {
      return true;
    }

    console.log('[YT Clipper] Upload dialog not open. Triggering Create -> Upload videos button...');
    updateBadgeStatus('Membuka dialog Upload Video di YouTube Studio...');

    // Try Create button
    const createBtn = document.querySelector('#create-icon') ||
                      document.querySelector('ytcp-button#create-icon') ||
                      document.querySelector('button[aria-label*="Create" i]') ||
                      document.querySelector('button[aria-label*="Buat" i]') ||
                      document.querySelector('#upload-icon') ||
                      document.querySelector('ytcp-icon-button#upload-icon');

    if (createBtn) {
      safeClick(createBtn);
      await sleep(600);

      // Look for "Upload videos" item in menu
      const uploadItem = document.querySelector('tp-yt-paper-item[test-id="upload-beta"]') ||
                         document.querySelector('#text-item-0') ||
                         document.querySelector('ytcp-text-menu #text-item-0') ||
                         Array.from(document.querySelectorAll('tp-yt-paper-item, ytcp-text-menu-item')).find(el => 
                           /upload\s*video/i.test(el.textContent || '')
                         );
      if (uploadItem) {
        safeClick(uploadItem);
        await sleep(1000);
      }
    }

    // Wait up to 10s for dialog to appear
    const dialog = await waitForElement(() => document.querySelector('ytcp-uploads-dialog, ytcp-video-upload-dialog'), 10000);
    return Boolean(dialog);
  }

  // In-memory blob cache per clipId: retry / re-queue dalam sesi yang sama
  // tidak mengunduh ulang file yang sama dari server lokal.
  const clipBlobCache = new Map<string, Blob>();

  async function injectVideoFile(data: UploadPayload): Promise<boolean> {
    updateStepperUI(1);
    updateBadgeStatus('Mengunduh file klip dari server lokal untuk auto-upload...');

    const clipId = data.clipId;
    const downloadUrl = data.videoUrl || `http://localhost:3002/api/clips/${clipId}`;
    const filename = data.filename || `clip_${clipId || Date.now()}.mp4`;
    const cacheKey = `${clipId || ''}|${downloadUrl}`;

    let file: File;
    try {
      let blob: Blob | undefined = clipBlobCache.get(cacheKey);
      if (!blob) {
        console.log('[YT Clipper] Fetching clip file from:', downloadUrl);
        const res = await fetch(downloadUrl);
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        blob = await res.blob();
        clipBlobCache.set(cacheKey, blob);
        // Batasi cache: simpan maksimal 3 file terakhir (hemat memori)
        while (clipBlobCache.size > 3) {
          const oldest = clipBlobCache.keys().next().value;
          if (oldest === undefined) break;
          clipBlobCache.delete(oldest);
        }
      } else {
        console.log('[YT Clipper] Reusing cached clip file:', filename, blob.size, 'bytes');
        updateBadgeStatus('Memakai file klip dari cache sesi (tanpa unduh ulang)...');
      }
      file = new File([blob], filename, { type: 'video/mp4' });
      console.log('[YT Clipper] Clip file ready:', file.name, file.size, 'bytes');
    } catch (err) {
      console.error('[YT Clipper] Failed to fetch clip file from server:', err);
      updateBadgeStatus(`⚠️ Gagal mengambil file video dari server: ${(err as Error).message}. Silakan drop file video manual.`, false, true);
      return false;
    }

    updateBadgeStatus('Menginjeksi file ke kotak upload YouTube Studio...');
    const dt = new DataTransfer();
    dt.items.add(file);

    // Find file input in YouTube upload dialog
    const fileInput = await waitForElement(() => {
      return document.querySelector('ytcp-uploads-dialog input[type="file"]') ||
             document.querySelector('ytcp-uploads-file-picker input[type="file"]') ||
             document.querySelector('input[type="file"][name="Filedata"]') ||
             document.querySelector('input[type="file"]');
    }, 8000) as HTMLInputElement | null;

    if (fileInput) {
      try {
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
        console.log('[YT Clipper] File attached to file input successfully');
      } catch (err) {
        console.warn('[YT Clipper] Direct file input assignment error:', err);
      }
    }

    // Also dispatch Drag & Drop event on upload zone
    const dropZone = document.querySelector('ytcp-uploads-file-picker') ||
                     document.querySelector('#drop-area') ||
                     document.querySelector('ytcp-uploads-dialog');
    if (dropZone) {
      try {
        const dropEvent = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt
        });
        dropZone.dispatchEvent(dropEvent);
      } catch (err) {
        console.warn('[YT Clipper] Drop event trigger error:', err);
      }
    }

    updateBadgeStatus('✅ File video terkirim! Menunggu form Detail YouTube Studio...');
    return true;
  }

  async function executeStep1Details(data: UploadPayload): Promise<boolean> {
    updateStepperUI(2);
    updateBadgeStatus('Menunggu form Detail (Judul & Deskripsi)...');

    // Wait for title input
    const titleBox = await waitForElement(() => {
      return document.querySelector('#title-textarea #textbox') ||
             document.querySelector('ytcp-mention-textbox[label="Title"] #textbox') ||
             document.querySelector('ytcp-mention-textbox[label="Judul"] #textbox') ||
             document.querySelector('div#textbox[aria-label*="title" i]') ||
             document.querySelector('div#textbox[aria-label*="judul" i]');
    }, 35000);

    if (!titleBox) {
      updateBadgeStatus('⚠️ Form Detail belum muncul. Pastikan file video diterima YouTube.', false, true);
      return false;
    }

    console.log('[YT Clipper] Title box detected, auto-filling metadata...');
    updateBadgeStatus('Mengisi Judul, Deskripsi & Hashtag...');

    // 1. Fill Title
    if (data.title) {
      setElementText(titleBox, data.title);
      await sleep(300);
    }

    // 2. Fill Description
    const descBox = document.querySelector('#description-textarea #textbox') ||
                    document.querySelector('ytcp-mention-textbox[label="Description"] #textbox') ||
                    document.querySelector('ytcp-mention-textbox[label="Deskripsi"] #textbox') ||
                    document.querySelector('div#textbox[aria-label*="description" i]') ||
                    document.querySelector('div#textbox[aria-label*="deskripsi" i]');
    if (descBox) {
      const fullDesc = `${data.description || ''}\n\n${(data.hashtags || []).join(' ')}`.trim();
      setElementText(descBox, fullDesc);
      await sleep(300);
    }

    // 3. Audience: "Not made for kids" (MANDATORY in YouTube Studio)
    updateBadgeStatus('Mengatur batas usia (Bukan untuk anak-anak)...');
    const notForKidsRadio = await waitForElement(() => {
      return document.querySelector('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]') ||
             document.querySelector('#not-made-for-kids-radio-button') ||
             document.querySelector('tp-yt-paper-radio-button#radio-button[aria-label*="not made for kids" i]') ||
             document.querySelector('tp-yt-paper-radio-button#radio-button[aria-label*="bukan dibuat untuk anak-anak" i]');
    }, 5000);

    if (notForKidsRadio) {
      safeClick(notForKidsRadio);
      await sleep(500);
    }

    updateBadgeStatus('✅ [1/4] Detail terisi! Menyiapkan langkah berikutnya...');
    await sleep(1000);

    // Pause checkpoint
    while (isAutomationPaused) {
      await sleep(500);
    }

    // Click Next button to advance to Step 2
    return await clickNextButton('Langkah 1 (Detail)');
  }

  async function clickNextButton(stepName: string): Promise<boolean> {
    updateBadgeStatus(`Mengklik 'Berikutnya' dari ${stepName}...`);

    // Wait until next button is ready and enabled
    let nextBtn: Element | null = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      nextBtn = document.querySelector('#next-button') ||
                document.querySelector('ytcp-button#next-button') ||
                document.querySelector('ytcp-button[aria-label*="Next" i]') ||
                document.querySelector('ytcp-button[aria-label*="Berikutnya" i]');

      if (nextBtn) {
        const isDisabled = nextBtn.hasAttribute('disabled') || nextBtn.getAttribute('aria-disabled') === 'true';
        if (!isDisabled) {
          break;
        }
      }
      await sleep(500);
    }

    if (!nextBtn) {
      console.warn(`[YT Clipper] Next button not found on ${stepName}`);
      return false;
    }

    safeClick(nextBtn);
    await sleep(1500);
    return true;
  }

  async function executeStep2Elements() {
    updateStepperUI(3);
    updateBadgeStatus('Tahap 2/4: Elemen Video (Dilewati untuk Shorts)...');
    await sleep(1200);

    while (isAutomationPaused) {
      await sleep(500);
    }

    return await clickNextButton('Langkah 2 (Elemen Video)');
  }

  async function executeStep3Checks() {
    updateStepperUI(3);
    updateBadgeStatus('Tahap 3/4: Pemeriksaan Hak Cipta...');
    await sleep(1200);

    while (isAutomationPaused) {
      await sleep(500);
    }

    return await clickNextButton('Langkah 3 (Pemeriksaan)');
  }

  async function executeStep4VisibilityAndPublish(data: UploadPayload): Promise<boolean> {
    updateStepperUI(4);

    await sleep(1000);

    // 1. Select Schedule or Public
    if (data.isScheduled && data.scheduleTime) {
      updateBadgeStatus(`Tahap 4/4: Mengatur Jadwal Tayang (${formatScheduleDisplay(data.scheduleTime)})...`);

      // Click Schedule radio button
      const scheduleRadio = await waitForElement(() => {
        return document.querySelector('#schedule-radio-button') ||
               document.querySelector('tp-yt-paper-radio-button[name="SCHEDULE"]') ||
               document.querySelector('#second-container');
      }, 5000);

      if (scheduleRadio) {
        safeClick(scheduleRadio);
        await sleep(800);
      }

      // Isi jam tayang (format lokal "YYYY-MM-DDTHH:mm", TANPA konversi zona).
      // Tanggal tidak disentuh — biarkan sesuai pilihan/ITS default Studio.
      const timeOk = await setStudioScheduleTime(data.scheduleTime);
      if (!timeOk) {
        updateBadgeStatus('Peringatan: jam gagal diisi otomatis — periksa/isi jam manual di dialog jadwal.', true);
        console.warn('[YT Clipper] Time picker fill failed for:', data.scheduleTime);
      }

    } else {
      updateBadgeStatus('Tahap 4/4: Mengatur Visibilitas Publik...');

      // Default: Public
      const publicRadio = await waitForElement(() => {
        return document.querySelector('tp-yt-paper-radio-button[name="PUBLIC"]') ||
               document.querySelector('tp-yt-paper-radio-button#radio-button[aria-label*="Public" i]') ||
               document.querySelector('tp-yt-paper-radio-button#radio-button[aria-label*="Publik" i]') ||
               document.querySelector('tp-yt-paper-radio-button[test-id="PUBLIC"]');
      }, 8000);

      if (publicRadio) {
        safeClick(publicRadio);
        await sleep(600);
      }
    }

    // 2. Publish or Review
    if (data.autoPublish === false) {
      updateBadgeStatus('⏸️ Mode Review: Form & Jadwal sudah diatur. Silakan klik "Jadwalkan/Publikasikan" jika siap!', true);
      const triggerBtn = document.getElementById('yt-clipper-trigger-btn');
      if (triggerBtn) triggerBtn.innerText = data.isScheduled ? '🕒 Jadwalkan Sekarang' : '🚀 Publikasikan Sekarang';
      return true;
    }

    while (isAutomationPaused) {
      await sleep(500);
    }

    const actionText = data.isScheduled ? 'Menjadwalkan video... 🕒' : 'Mempublikasikan video ke YouTube... 🚀';
    updateBadgeStatus(actionText);
    await sleep(1000);

    // Find Done / Schedule / Publish button
    let doneBtn: Element | null = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      doneBtn = document.querySelector('#done-button') ||
                document.querySelector('ytcp-button#done-button') ||
                document.querySelector('ytcp-button[aria-label*="Schedule" i]') ||
                document.querySelector('ytcp-button[aria-label*="Jadwalkan" i]') ||
                document.querySelector('ytcp-button[aria-label*="Publish" i]') ||
                document.querySelector('ytcp-button[aria-label*="Publikasikan" i]') ||
                document.querySelector('ytcp-button[aria-label*="Save" i]') ||
                document.querySelector('ytcp-button[aria-label*="Simpan" i]');

      if (doneBtn) {
        const isDisabled = doneBtn.hasAttribute('disabled') || doneBtn.getAttribute('aria-disabled') === 'true';
        if (!isDisabled) break;
      }
      await sleep(500);
    }

    if (doneBtn) {
      safeClick(doneBtn);
      console.log('[YT Clipper] Schedule/Publish button clicked successfully!');
      updateBadgeStatus('🚀 Permintaan terkirim! Menunggu konfirmasi YouTube Studio...', true);
      await monitorUploadCompletion(data);
      return true;
    } else {
      updateBadgeStatus('⚠️ Tombol Jadwalkan/Publikasikan tidak ditemukan. Silakan klik tombol biru di YouTube Studio.', false, true);
      return false;
    }
  }

  async function monitorUploadCompletion(data: UploadPayload): Promise<void> {
    // Poll for the completion share dialog
    const shareDialog = await waitForElement(() => {
      return document.querySelector('ytcp-video-share-dialog') ||
             document.querySelector('ytcp-uploads-dialog[dialog-type="share"]') ||
             document.querySelector('a.ytcp-video-info') ||
             document.querySelector('#share-url');
    }, 25000);

    let videoUrl = '';
    if (shareDialog) {
      const linkEl = document.querySelector('#share-url') || document.querySelector('a.ytcp-video-info');
      if (linkEl && (linkEl as HTMLAnchorElement).href) {
        videoUrl = (linkEl as HTMLAnchorElement).href;
      }
    }

    // Check if there are more items in batch queue
    let hasMoreInQueue = false;
    let nextItem: UploadPayload | null = null;
    try {
      const advRes = await fetch('http://localhost:3002/api/pending-upload/advance', { method: 'POST' });
      if (advRes.ok) {
        const advJson: any = await advRes.json();
        hasMoreInQueue = Boolean(advJson.hasMore && advJson.next);
        nextItem = advJson.next;
      }
    } catch (err) {
      console.warn('[YT Clipper] Advance queue error:', err);
    }

    if (hasMoreInQueue && nextItem) {
      const nextSched = nextItem.scheduleTime ? ` (Jadwal: ${formatScheduleDisplay(nextItem.scheduleTime)})` : '';
      updateBadgeStatus(`✅ Video selesai! Menyiapkan antrean berikutnya [${(nextItem.queueIndex || 0) + 1}/${nextItem.queueTotal}]${nextSched} dalam 3 detik...`, true);

      // Close current share dialog
      const closeShareBtn = document.querySelector('ytcp-video-share-dialog #close-button') ||
                            document.querySelector('#close-button') ||
                            document.querySelector('button[aria-label*="Close" i]') ||
                            document.querySelector('button[aria-label*="Tutup" i]');
      if (closeShareBtn) {
        safeClick(closeShareBtn);
      }
      await sleep(2500);

      // Launch next item in queue!
      runFullAutoUploadWorkflow(nextItem);

    } else {
      // All items completed
      const completionText = data.isScheduled
        ? '🎉 SUKSES! Semua video antrean berhasil dijadwalkan di YouTube Studio!'
        : '🎉 SUKSES! Semua video YouTube Shorts berhasil diupload & dipublikasikan!';
      updateBadgeStatus(completionText, true);

      const urlContainer = document.getElementById('yt-clipper-url-container');
      const urlLink = document.getElementById('yt-clipper-url-link') as HTMLAnchorElement | null;
      if (urlContainer && urlLink && videoUrl) {
        urlLink.href = videoUrl;
        urlContainer.style.display = 'block';
      }

      const triggerBtn = document.getElementById('yt-clipper-trigger-btn');
      if (triggerBtn) {
        triggerBtn.innerText = '✅ Antrean Selesai';
        triggerBtn.style.background = '#22c55e';
      }

      clearPendingUpload();
    }
  }

  // Master controller coordinating the whole auto-upload pipeline
  async function runFullAutoUploadWorkflow(data: UploadPayload): Promise<void> {
    try {
      console.log('[YT Clipper] Starting auto-upload workflow for:', data.title, data.isScheduled ? `(Schedule: ${data.scheduleTime})` : '');
      currentProcessingData = data;
      createFloatingBadge(data);

      // Step 0: Ensure upload dialog is open
      const hasDialog = await openUploadDialogIfNeeded();
      if (!hasDialog) {
        console.warn('[YT Clipper] Could not open upload dialog automatically.');
      }

      // Check if file is already being processed or if we need to inject it
      const alreadyHasDetails = document.querySelector('#title-textarea #textbox') ||
                                document.querySelector('ytcp-mention-textbox[label="Title"] #textbox');

      if (!alreadyHasDetails) {
        const injected = await injectVideoFile(data);
        if (!injected) {
          console.warn('[YT Clipper] File auto-injection did not complete, waiting for manual drop...');
        }
      } else {
        console.log('[YT Clipper] Details form is already open, skipping file injection...');
      }

      // Step 1: Details (Title, Desc, Audience -> Next)
      const step1Success = await executeStep1Details(data);
      if (!step1Success) return;

      // Step 2: Video Elements (Next)
      const step2Success = await executeStep2Elements();
      if (!step2Success) return;

      // Step 3: Checks (Next)
      const step3Success = await executeStep3Checks();
      if (!step3Success) return;

      // Step 4: Visibility & Publish/Schedule (Done)
      await executeStep4VisibilityAndPublish(data);

    } catch (err) {
      console.error('[YT Clipper] Workflow error:', err);
      updateBadgeStatus(`❌ Terjadi kendala: ${(err as Error).message}`, false, true);
    }
  }

  // ── 5. Watcher & Auto-Start ────────────────────────────────────────────
  getPendingUpload((data) => {
    if (!data) return;

    const now = Date.now();
    // Valid for 1 hour
    if (data.timestamp && (now - data.timestamp > 3600000)) {
      clearPendingUpload();
      return;
    }

    console.log('[YT Clipper] Initializing auto-upload for:', data.title);
    createFloatingBadge(data);

    // Automatically trigger workflow after 1.2s to let YouTube Studio settle
    setTimeout(() => {
      runFullAutoUploadWorkflow(data);
    }, 1200);
  });
})();
