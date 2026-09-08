import { useState, useEffect } from 'react';
import { API, PLATFORMS, PENDING_KEY, STUDIO_UPLOAD_URL } from '../lib/api';
import { toLocalInputValue } from '../lib/format';
import type { ClipMeta, Platform, BatchCaption } from '../types';

declare const chrome: any;

interface UploadDeps {
  clips: ClipMeta[];
  downloadClip: (clip: ClipMeta) => void;
}

export function useUpload({ clips, downloadClip }: UploadDeps) {
  const [selectedClipId, setSelectedClipId] = useState('');
  const [enabledPlatforms, setEnabledPlatforms] = useState<Record<Platform, boolean>>({
    youtube: true, tiktok: true, facebook: false, instagram: false,
  });

  // ── Upload Tab Caption & Scheduling
  const [generatingCaption, setGeneratingCaption] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [channelName, setChannelName] = useState(() => localStorage.getItem('yt_clipper_channel') || '');
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [isScheduleActive, setIsScheduleActive] = useState(false);
  const [scheduleTime, setScheduleTime] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(18, 0, 0, 0);
    return toLocalInputValue(tomorrow);
  });
  const [uploadStatusMsg, setUploadStatusMsg] = useState('');
  const [autoPublishMode, setAutoPublishMode] = useState<boolean>(true);

  // ── Batch Scheduling & Multi-Video Upload Queue
  const [uploadSubMode, setUploadSubMode] = useState<'single' | 'batch'>('single');
  const [selectedBatchClipIds, setSelectedBatchClipIds] = useState<string[]>([]);
  const [batchIntervalHours, setBatchIntervalHours] = useState<number>(4);
  const [batchDailyQuota, setBatchDailyQuota] = useState<number>(3); // video per hari, 0 = tanpa batas
  const [showAutoUpload, setShowAutoUpload] = useState<boolean>(false);
  const [saveDiskBackup, setSaveDiskBackup] = useState<boolean>(false);
  const [batchUploading, setBatchUploading] = useState<boolean>(false);
  const [batchStartTime, setBatchStartTime] = useState(() => {
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    return toLocalInputValue(nextHour);
  });
  const [customClipSchedules, setCustomClipSchedules] = useState<Record<string, string>>({});
  const [batchCaptions, setBatchCaptions] = useState<Record<string, BatchCaption>>({});
  const [generatingBatchCaptions, setGeneratingBatchCaptions] = useState(false);

  // Prefill antrean batch: prioritas pilihan dari halaman Library,
  // lalu semua klip bila belum ada pilihan.
  useEffect(() => {
    if (clips.length === 0) return;
    try {
      const raw = localStorage.getItem('yt_clipper_library_selection');
      if (raw) {
        const ids = (JSON.parse(raw) as string[]).filter(id => clips.some(c => c.id === id));
        localStorage.removeItem('yt_clipper_library_selection');
        if (ids.length > 0) {
          setSelectedBatchClipIds(ids);
          setUploadSubMode('batch');
          return;
        }
      }
    } catch { /* abaikan */ }
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['yt_clipper_library_selection'], (res: any) => {
        const ids = (res?.yt_clipper_library_selection || []).filter((id: string) => clips.some(c => c.id === id));
        chrome.storage.local.remove(['yt_clipper_library_selection']);
        if (ids.length > 0) {
          setSelectedBatchClipIds(ids);
          setUploadSubMode('batch');
        } else {
          setSelectedBatchClipIds(prev => (prev.length === 0 ? clips.map(c => c.id) : prev));
        }
      });
      return;
    }
    setSelectedBatchClipIds(prev => (prev.length === 0 ? clips.map(c => c.id) : prev));
  }, [clips]);

  const togglePlatform = (key: Platform) => {
    setEnabledPlatforms(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const selectedClip = clips.find(c => c.id === selectedClipId) || null;
  // Platform caption mengikuti framing: mlbb 4:3 = video turnamen reguler
  // (tanpa #Shorts), sisanya Shorts.
  const captionPlatform = selectedClip?.framing === 'mlbb' ? 'tournament' : 'youtube';

  useEffect(() => {
    if (selectedClip) {
      const clipChannel = (selectedClip as any).channel || '';
      if (clipChannel && !channelName) {
        setChannelName(clipChannel);
      }
      const activeCh = channelName || clipChannel;
      const chTag = activeCh ? ` #${activeCh.trim().replace(/\s+/g, '')}` : '';
      const isReg = selectedClip.framing === 'mlbb';
      setUploadTitle(selectedClip.title ? (isReg ? `${selectedClip.title.slice(0, 80)} | MLBB` : `${selectedClip.title.slice(0, 80)} #Shorts`) : '');
      setUploadDesc(selectedClip.transcript ? `Momen seru: ${selectedClip.title}\n\nJangan lupa like, komen, dan subscribe untuk video seru lainnya!` : 'Tonton video seru ini!');
      setUploadTags(isReg ? `#MLBB #MobileLegends${chTag} #Turnamen #Viral` : `#Shorts #YouTubeShorts${chTag} #Viral #FYP #Trending`);
      setUploadStatusMsg('');
    }
  }, [selectedClipId]);

  const handleGenerateAICaption = async () => {
    if (!selectedClip) return;
    setGeneratingCaption(true);
    setUploadStatusMsg('');
    try {
      const activeCh = channelName || (selectedClip as any).channel || '';
      const res = await fetch(`${API}/api/generate-caption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clipId: selectedClip.id,
          platform: captionPlatform,
          channelName: activeCh,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membuat caption AI');
      if (data.caption) {
        setUploadTitle(data.caption.title || '');
        setUploadDesc(data.caption.description || '');
        setUploadTags((data.caption.hashtags || []).join(' '));
        if (data.channelName && !channelName) {
          setChannelName(data.channelName);
          localStorage.setItem('yt_clipper_channel', data.channelName);
        }
        setUploadStatusMsg('Judul viral, deskripsi dan tagar berhasil dibuat AI.');
      }
    } catch (e: any) {
      setUploadStatusMsg(`Gagal: ${e.message}`);
    } finally {
      setGeneratingCaption(false);
    }
  };

  const syncPendingUpload = async (payload: unknown) => {
    // 1. Sync to backend pending upload store (reliable across all browser tabs & localhost ports)
    try {
      await fetch(`${API}/api/pending-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.warn('Backend pending-upload sync error:', err);
    }

    // 2. Extension storage fallback
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [PENDING_KEY]: payload });
    }
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(payload));
    } catch { /* ignore */ }
  };

  const handleUploadToYouTubeShorts = async () => {
    if (!selectedClip) return;

    const tagsArray = uploadTags.split(/\s+/).filter(t => t.trim().length > 0);
    const activeCh = channelName || (selectedClip as any).channel || '';
    const payload = {
      title: uploadTitle || selectedClip.title,
      description: uploadDesc,
      hashtags: tagsArray,
      channelName: activeCh,
      isScheduled: isScheduleActive,
      scheduleTime: isScheduleActive ? scheduleTime : null,
      clipId: selectedClip.id,
      videoUrl: `${API}/clips/${selectedClip.filename}`,
      filename: selectedClip.filename,
      autoPublish: autoPublishMode,
      timestamp: Date.now(),
    };

    await syncPendingUpload(payload);

    // Backup lokal ke disk (opsional) — upload Studio tidak membutuhkannya
    // karena ekstensi mengambil file langsung dari server via fetch.
    if (saveDiskBackup) downloadClip(selectedClip);

    setTimeout(() => {
      window.open(STUDIO_UPLOAD_URL, '_blank');
    }, 500);

    setUploadStatusMsg(
      autoPublishMode
        ? 'YouTube Studio dibuka. Ekstensi otomatis mengisi video, judul dan deskripsi sampai terbit.'
        : 'YouTube Studio dibuka. Ekstensi mengisi form otomatis, lalu menunggu pemeriksaan sebelum terbit.'
    );
  };

  const handleCopyAllCaption = () => {
    const full = `${uploadTitle}\n\n${uploadDesc}\n\n${uploadTags}`.trim();
    navigator.clipboard.writeText(full);
    setUploadStatusMsg('Judul, deskripsi, dan tagar disalin ke clipboard.');
  };

  // ── Batch Scheduling Helper Methods
  const getClipScheduledTime = (clipId: string, indexInSelected: number): string => {
    if (customClipSchedules[clipId]) {
      return customClipSchedules[clipId];
    }
    const base = new Date(batchStartTime || Date.now());
    let target: Date;
    if (batchDailyQuota > 0) {
      // Kuota harian ramah algoritma: maks N video/hari, sisanya geser ke hari berikut
      const day = Math.floor(indexInSelected / batchDailyQuota);
      const slot = indexInSelected % batchDailyQuota;
      target = new Date(base.getTime() + day * 24 * 60 * 60 * 1000 + slot * batchIntervalHours * 60 * 60 * 1000);
    } else {
      const offsetMs = indexInSelected * batchIntervalHours * 60 * 60 * 1000;
      target = new Date(base.getTime() + offsetMs);
    }
    // Waktu lokal mentah — JANGAN toISOString (menggeser ke UTC).
    return toLocalInputValue(target);
  };

  const toggleSelectBatchClip = (id: string) => {
    setSelectedBatchClipIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAllBatch = () => {
    if (selectedBatchClipIds.length === clips.length) {
      setSelectedBatchClipIds([]);
    } else {
      setSelectedBatchClipIds(clips.map(c => c.id));
    }
  };

  const handleGenerateBatchAICaptions = async () => {
    if (selectedBatchClipIds.length === 0) return;
    setGeneratingBatchCaptions(true);
    setUploadStatusMsg('');
    try {
      const activeCh = channelName || '';
      const res = await fetch(`${API}/api/generate-captions-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clipIds: selectedBatchClipIds,
          platform: 'youtube',
          channelName: activeCh,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membuat caption AI batch');
      if (data.results) {
        setBatchCaptions(prev => ({ ...prev, ...data.results }));
        setUploadStatusMsg(`Caption AI selesai untuk ${Object.keys(data.results).length} video antrean.`);
      }
    } catch (e: any) {
      setUploadStatusMsg(`Gagal: ${e.message}`);
    } finally {
      setGeneratingBatchCaptions(false);
    }
  };

  const handleStartBatchUpload = async () => {
    if (selectedBatchClipIds.length === 0) {
      setUploadStatusMsg('Pilih minimal 1 video untuk antrean jadwal.');
      return;
    }
    if (batchUploading) return; // anti klik-ganda: antrean sedang dikirim
    setBatchUploading(true);
    try {

    const activeCh = channelName || '';
    const chTag = activeCh ? ` #${activeCh.trim().replace(/\s+/g, '')}` : '';

    const items = selectedBatchClipIds.map((cid, idx) => {
      const clip = clips.find(c => c.id === cid)!;
      const cap = batchCaptions[cid];
      const schedTime = getClipScheduledTime(cid, idx);

      const title = cap?.title || (clip.title ? `${clip.title.slice(0, 80)} #Shorts` : 'Short Video');
      const desc = cap?.description || (clip.transcript ? `Momen seru: ${clip.title}\n\nJangan lupa like & subscribe!` : 'Tonton video seru ini!');
      const tags = cap?.hashtags || ['#Shorts', '#YouTubeShorts', '#Viral', chTag].filter(Boolean);

      return {
        clipId: clip.id,
        title,
        description: desc,
        hashtags: tags,
        channelName: activeCh,
        isScheduled: true,
        scheduleTime: schedTime,
        videoUrl: `${API}/clips/${clip.filename}`,
        filename: clip.filename,
        autoPublish: true,
        queueIndex: idx,
        queueTotal: selectedBatchClipIds.length,
      };
    });

    // 1. Sync batch queue to backend pending-upload store
    try {
      await fetch(`${API}/api/pending-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
    } catch (err) {
      console.warn('Backend batch pending-upload sync error:', err);
    }

    // 2. Extension storage fallback
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [PENDING_KEY]: items[0] });
    }

    // Backup lokal ke disk (opsional) — upload Studio mengambil file
    // langsung dari server, jadi backup ini tidak wajib.
    if (saveDiskBackup) {
      const firstClip = clips.find(c => c.id === selectedBatchClipIds[0]);
      if (firstClip) downloadClip(firstClip);
    }

    setTimeout(() => {
      window.open(STUDIO_UPLOAD_URL, '_blank');
    }, 500);

    setUploadStatusMsg(
      `Antrean ${items.length} video dibuat. Tab YouTube Studio dibuka dan ekstensi menjadwalkan tiap video otomatis.`
    );
    } finally {
      setBatchUploading(false);
    }
  };

  const openAllPlatforms = () => {
    const selected = PLATFORMS.filter(p => enabledPlatforms[p.key]);
    if (selected.length === 0) return;
    const clip = clips.find(c => c.id === selectedClipId);
    if (clip) downloadClip(clip);
    selected.forEach((p, i) => {
      setTimeout(() => window.open(p.url, '_blank'), i * 300);
    });
  };

  const enabledCount = Object.values(enabledPlatforms).filter(Boolean).length;

  return {
    selectedClipId, setSelectedClipId, selectedClip,
    enabledPlatforms, togglePlatform, enabledCount,
    generatingCaption, uploadTitle, setUploadTitle,
    channelName, setChannelName,
    uploadDesc, setUploadDesc, uploadTags, setUploadTags,
    isScheduleActive, setIsScheduleActive,
    scheduleTime, setScheduleTime,
    uploadStatusMsg, autoPublishMode, setAutoPublishMode,
    uploadSubMode, setUploadSubMode,
    selectedBatchClipIds, batchIntervalHours, setBatchIntervalHours,
    batchDailyQuota, setBatchDailyQuota,
    showAutoUpload, setShowAutoUpload,
    saveDiskBackup, setSaveDiskBackup,
    batchUploading, batchStartTime, setBatchStartTime,
    customClipSchedules, setCustomClipSchedules,
    batchCaptions, setBatchCaptions, generatingBatchCaptions,
    handleGenerateAICaption, handleUploadToYouTubeShorts, handleCopyAllCaption,
    getClipScheduledTime, toggleSelectBatchClip, toggleSelectAllBatch,
    handleGenerateBatchAICaptions, handleStartBatchUpload, openAllPlatforms,
  };
}

export type UploadApi = ReturnType<typeof useUpload>;
