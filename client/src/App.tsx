import { useState, useEffect, useCallback } from 'react';
import './App.css';

type ClipMeta = {
  id: string;
  title: string;
  channel?: string;
  sourceUrl: string;
  startSec: number;
  endSec: number;
  duration: number;
  durationFormatted: string;
  framing?: 'smart' | 'streamer' | 'blur' | 'crop' | 'landscape';
  facecamPos?: string;
  quality?: '1080p' | '720p';
  resolution?: string;
  hasCaptions?: boolean;
  filename: string;
  fileSize: number;
  fileSizeMB: string;
  createdAt: string;
  transcript: string | null;
  virality: {
    total: number;
    grade: string;
    scores: Record<string, number>;
    tips: string[];
  } | null;
};

type ViralMoment = {
  title: string;
  startSec: number;
  endSec: number;
  duration: number;
  viralityScore: number;
  hook: string;
  reason: string;
  selected?: boolean;
};

type Tab = 'create' | 'history' | 'upload';
type CreateMode = 'auto' | 'manual';
type Platform = 'youtube' | 'tiktok' | 'facebook' | 'instagram';
type FramingMode = 'smart' | 'streamer' | 'blur' | 'crop' | 'landscape';

type GameBreak = {
  time: number;
  label: string;
  source: string;
};
type FacecamPosition = 'auto' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
type QualityMode = '1080p' | '720p';
type CaptionPosition = 'middle' | 'top' | 'bottom';

declare const chrome: any;

const API = 'http://localhost:3002';

const PLATFORMS: { key: Platform; name: string; icon: string; desc: string; color: string; url: string }[] = [
  { key: 'youtube', name: 'YouTube Shorts', icon: '🎬', desc: 'Upload di YouTube Studio', color: '#ff0000', url: 'https://studio.youtube.com/channel/UC/videos/upload' },
  { key: 'tiktok', name: 'TikTok', icon: '🎵', desc: 'Upload di Creator Center', color: '#00f2ea', url: 'https://www.tiktok.com/creator#/upload?scene=creator_center' },
  { key: 'facebook', name: 'Facebook Reels', icon: '📘', desc: 'Buat Reel baru', color: '#1877f2', url: 'https://www.facebook.com/reels/create' },
  { key: 'instagram', name: 'Instagram Reels', icon: '📸', desc: 'Upload via web/app', color: '#e4405f', url: 'https://www.instagram.com/' },
];

function App() {
  const [tab, setTab] = useState<Tab>('create');
  const [createMode, setCreateMode] = useState<CreateMode>('auto');

  // ── Settings Modal
  const [showSettings, setShowSettings] = useState(false);
  const [aiProvider, setAiProvider] = useState<'groq' | 'openai'>('groq');
  const [groqKeyInput, setGroqKeyInput] = useState('');
  const [openaiKeyInput, setOpenaiKeyInput] = useState('');
  const [hasGroqKey, setHasGroqKey] = useState(false);
  const [hasOpenaiKey, setHasOpenaiKey] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState('');

  // ── Create Tab Common
  const [url, setUrl] = useState('');
  const [framing, setFraming] = useState<FramingMode>('smart');
  const [facecamPos, setFacecamPos] = useState<FacecamPosition>('auto');
  const [quality, setQuality] = useState<QualityMode>('1080p');
  const [burnCaptions, setBurnCaptions] = useState(true);
  const [captionPos, setCaptionPos] = useState<CaptionPosition>('middle');

  // ── Manual mode
  const [start, setStart] = useState('0:00');
  const [end, setEnd] = useState('0:45');

  // ── Auto AI mode
  const [detectingMoments, setDetectingMoments] = useState(false);
  const [detectedMoments, setDetectedMoments] = useState<ViralMoment[]>([]);
  const [videoTitle, setVideoTitle] = useState('');
  const [transcriptSegments, setTranscriptSegments] = useState<any[]>([]);
  const [targetDuration, setTargetDuration] = useState<'auto' | 'short' | 'medium' | 'long' | 'custom'>('auto');
  const [customMinDuration, setCustomMinDuration] = useState<number>(15);
  const [customMaxDuration, setCustomMaxDuration] = useState<number>(90);

  // ── Progress & status
  const [loading, setLoading] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressStage, setProgressStage] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // ── History
  const [clips, setClips] = useState<ClipMeta[]>([]);
  const [loadingClips, setLoadingClips] = useState(false);
  const [previewClipId, setPreviewClipId] = useState<string | null>(null);

  // ── Upload Tab
  const [selectedClipId, setSelectedClipId] = useState('');
  const [enabledPlatforms, setEnabledPlatforms] = useState<Record<Platform, boolean>>({
    youtube: true, tiktok: true, facebook: false, instagram: false,
  });

  // ── Transcript expander
  const [transcriptClipId, setTranscriptClipId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [loadingVirality, setLoadingVirality] = useState<string | null>(null);

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
    return tomorrow.toISOString().slice(0, 16);
  });
  const [uploadStatusMsg, setUploadStatusMsg] = useState('');
  const [autoPublishMode, setAutoPublishMode] = useState<boolean>(true);

  // ── Batch Scheduling & Multi-Video Upload Queue
  const [uploadSubMode, setUploadSubMode] = useState<'single' | 'batch'>('single');
  const [selectedBatchClipIds, setSelectedBatchClipIds] = useState<string[]>([]);
  const [batchIntervalHours, setBatchIntervalHours] = useState<number>(4);
  const [batchDailyQuota, setBatchDailyQuota] = useState<number>(3); // video per hari, 0 = tanpa batas
  const [maxMoments, setMaxMoments] = useState<number>(10);
  // ── Mode turnamen (VOD panjang: skala limit + deteksi batas game)
  const [matchMode, setMatchMode] = useState<boolean>(false);
  const [gameBreaks, setGameBreaks] = useState<GameBreak[]>([]);
  const [visibleMomentCount, setVisibleMomentCount] = useState<number>(20);
  const [showAutoUpload, setShowAutoUpload] = useState<boolean>(false);
  const [saveDiskBackup, setSaveDiskBackup] = useState<boolean>(false);
  const [batchUploading, setBatchUploading] = useState<boolean>(false);
  const [batchStartTime, setBatchStartTime] = useState(() => {
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    return nextHour.toISOString().slice(0, 16);
  });
  const [customClipSchedules, setCustomClipSchedules] = useState<Record<string, string>>({});
  const [batchCaptions, setBatchCaptions] = useState<Record<string, { title: string; description: string; hashtags: string[] }>>({});
  const [generatingBatchCaptions, setGeneratingBatchCaptions] = useState(false);

  // ── Fetch Settings (LocalStorage + Server Sync)
  const fetchSettings = useCallback(async () => {
    // 1. Load from localStorage first
    const localProvider = (localStorage.getItem('yt_clipper_provider') as 'groq' | 'openai') || 'groq';
    const localGroq = localStorage.getItem('yt_clipper_groq_key') || '';
    const localOpenai = localStorage.getItem('yt_clipper_openai_key') || '';

    setAiProvider(localProvider);
    if (localGroq) {
      setGroqKeyInput(localGroq);
      setHasGroqKey(true);
    }
    if (localOpenai) {
      setOpenaiKeyInput(localOpenai);
      setHasOpenaiKey(true);
    }

    // 2. Try sync with backend
    try {
      const r = await fetch(`${API}/api/settings`);
      if (r.ok) {
        const data = await r.json();
        if (data.provider) setAiProvider(data.provider);
        if (data.hasGroqKey) setHasGroqKey(true);
        if (data.hasOpenaiKey) setHasOpenaiKey(true);
        if (data.groqApiKey && !localGroq) setGroqKeyInput(data.groqApiKey);
        if (data.openaiApiKey && !localOpenai) setOpenaiKeyInput(data.openaiApiKey);
      }
    } catch { /* ignore backend offline / restarting */ }
  }, []);

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsMsg('');

    // Save to localStorage immediately (never fails)
    localStorage.setItem('yt_clipper_provider', aiProvider);
    if (groqKeyInput && !groqKeyInput.includes('••••')) {
      localStorage.setItem('yt_clipper_groq_key', groqKeyInput);
      setHasGroqKey(true);
    }
    if (openaiKeyInput && !openaiKeyInput.includes('••••')) {
      localStorage.setItem('yt_clipper_openai_key', openaiKeyInput);
      setHasOpenaiKey(true);
    }

    setSettingsMsg('✅ Pengaturan berhasil disimpan!');

    // Sync to backend
    try {
      await fetch(`${API}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: aiProvider,
          groqApiKey: groqKeyInput,
          openaiApiKey: openaiKeyInput,
        }),
      });
    } catch { /* ignore */ }

    setTimeout(() => setShowSettings(false), 1000);
  };

  const parseTime = (t: string): number => {
    if (t.includes(':')) {
      const parts = t.split(':');
      const mins = parseInt(parts[0], 10);
      const secs = parseInt(parts[1] || '0', 10);
      if (isNaN(mins) || isNaN(secs)) return NaN;
      return mins * 60 + secs;
    }
    return parseFloat(t);
  };

  const formatSec = (sec: number): string => {
    if (isNaN(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const applyManualDurationPreset = (presetSec: number) => {
    const startNum = isNaN(parseTime(start)) ? 0 : Math.max(0, parseTime(start));
    const newEndSec = startNum + presetSec;
    setEnd(formatSec(newEndSec));
  };

  const nudgeManualEnd = (deltaSec: number) => {
    const startNum = isNaN(parseTime(start)) ? 0 : Math.max(0, parseTime(start));
    const endNum = isNaN(parseTime(end)) ? startNum + 45 : parseTime(end);
    const newEndSec = Math.max(startNum + 3, endNum + deltaSec);
    setEnd(formatSec(newEndSec));
  };

  const updateMomentTime = (index: number, newStart: number, newEnd: number) => {
    setDetectedMoments(prev => {
      const updated = [...prev];
      if (!updated[index]) return prev;
      const startClamped = Math.max(0, Math.round(newStart));
      const endClamped = Math.max(startClamped + 3, Math.round(newEnd));
      updated[index] = {
        ...updated[index],
        startSec: startClamped,
        endSec: endClamped,
        duration: endClamped - startClamped,
      };
      return updated;
    });
  };

  const updateMomentDuration = (index: number, deltaSec: number) => {
    const m = detectedMoments[index];
    if (!m) return;
    const newEnd = Math.max(m.startSec + 3, m.endSec + deltaSec);
    updateMomentTime(index, m.startSec, newEnd);
  };

  const fetchClips = useCallback(async () => {
    setLoadingClips(true);
    try {
      const r = await fetch(`${API}/api/clips`);
      const data = await r.json();
      setClips(data);
      if (data && data.length > 0) {
        setSelectedBatchClipIds(prev => prev.length === 0 ? data.map((c: any) => c.id) : prev);
      }
    } catch { /* ignore */ }
    setLoadingClips(false);
  }, []);

  useEffect(() => {
    fetchClips();
    fetchSettings();
  }, [fetchClips, fetchSettings]);

  // ── Auto Detect Viral Moments with AI
  const handleAutoDetect = async () => {
    setError('');
    if (!url) { setError('YouTube URL wajib diisi'); return; }
    if (!hasGroqKey && !hasOpenaiKey && !groqKeyInput && !openaiKeyInput) {
      setShowSettings(true);
      setError('Masukkan API Key AI terlebih dahulu (Groq gratis atau OpenAI).');
      return;
    }

    setDetectingMoments(true);
    setProgressPercent(10);
    setProgressStage('Menghubungkan AI untuk analisis video...');
    setDetectedMoments([]);
    setGameBreaks([]);
    setVisibleMomentCount(20);

    try {
      const localGroq = localStorage.getItem('yt_clipper_groq_key') || groqKeyInput;
      const localOpenai = localStorage.getItem('yt_clipper_openai_key') || openaiKeyInput;
      const localProvider = localStorage.getItem('yt_clipper_provider') || aiProvider;

      const response = await fetch(`${API}/api/auto-detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          youtubeUrl: url,
          provider: localProvider,
          groqApiKey: localGroq,
          openaiApiKey: localOpenai,
          targetDuration,
          minDuration: customMinDuration,
          maxDuration: customMaxDuration,
          maxMoments,
          matchMode,
          detectGames: matchMode,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        if (errData.needsConfig) setShowSettings(true);
        throw new Error(errData.error || 'Gagal menganalisis video dengan AI');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const chunk of parts) {
            const trimmed = chunk.trim();
            if (trimmed.startsWith('data: ')) {
              try {
                const event = JSON.parse(trimmed.slice(6));
                if (event.type === 'progress') {
                  setProgressPercent(event.percent);
                  setProgressStage(event.stage);
                } else if (event.type === 'done') {
                  setProgressPercent(100);
                  setProgressStage('Analisis viral selesai!');
                  setVideoTitle(event.videoTitle || '');
                  setTranscriptSegments(event.transcriptSegments || []);
                  setGameBreaks(event.gameBreaks || []);
                  const moments = (event.moments || []).map((m: ViralMoment) => ({ ...m, selected: true }));
                  setDetectedMoments(moments);
                } else if (event.type === 'error') {
                  throw new Error(event.message);
                }
              } catch (parseErr: any) {
                if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
              }
            }
          }
        }
      }
    } catch (e: any) {
      setError(e.message || 'Gagal mendeteksi momen viral');
    } finally {
      setDetectingMoments(false);
    }
  };

  // ── Single Clip Stream Generator Helper
  const processSingleClip = async (startSec: number, endSec: number, title?: string, segs?: any[]) => {
    const localGroq = localStorage.getItem('yt_clipper_groq_key') || groqKeyInput;
    const localOpenai = localStorage.getItem('yt_clipper_openai_key') || openaiKeyInput;
    const localProvider = localStorage.getItem('yt_clipper_provider') || aiProvider;

    const response = await fetch(`${API}/api/clip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        youtubeUrl: url,
        startSec,
        endSec,
        framing,
        facecamPos: framing === 'streamer' ? facecamPos : undefined,
        quality,
        burnCaptions,
        captionPos: burnCaptions ? captionPos : undefined,
        customTitle: title,
        transcriptSegments: segs || transcriptSegments,
        provider: localProvider,
        groqApiKey: localGroq,
        openaiApiKey: localOpenai,
      }),
    });

    if (!response.ok) throw new Error('Gagal memproses clip di server');

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const chunk of parts) {
          const trimmed = chunk.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const event = JSON.parse(trimmed.slice(6));
              if (event.type === 'progress') {
                setProgressPercent(event.percent);
                setProgressStage(event.stage);
              } else if (event.type === 'done') {
                if (event.clip) downloadClip(event.clip);
              } else if (event.type === 'error') {
                throw new Error(event.message);
              }
            } catch (pErr: any) {
              if (pErr.message && !pErr.message.includes('JSON')) throw pErr;
            }
          }
        }
      }
    }
  };

  // ── Manual Mode Submit
  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    if (!url) { setError('YouTube URL wajib diisi'); return; }
    const startNum = parseTime(start);
    const endNum = parseTime(end);
    if (isNaN(startNum) || isNaN(endNum) || endNum <= startNum) {
      setError('Waktu start/end tidak valid');
      return;
    }

    setLoading(true);
    setProgressPercent(5);
    setProgressStage('Menghubungkan ke server...');

    try {
      await processSingleClip(startNum, endNum);
      setProgressPercent(100);
      setProgressStage('Clip selesai diproses!');
      setSuccess(true);
      fetchClips();
      setTimeout(() => setSuccess(false), 6000);
    } catch (e: any) {
      const msg = e.message || '';
      if (/failed to fetch|network error|networkerror|econnrefused/i.test(msg)) {
        setError('Koneksi ke backend (port 3002) terputus. Pastikan server backend sedang berjalan.');
      } else {
        setError(msg || 'Gagal memproses clip');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Batch Generate All Selected AI Moments
  const handleBatchGenerate = async () => {
    const selected = detectedMoments.filter(m => m.selected);
    if (selected.length === 0) {
      setError('Pilih minimal 1 momen viral untuk di-generate');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess(false);

    try {
      for (let i = 0; i < selected.length; i++) {
        const m = selected[i];
        setProgressStage(`[${i + 1}/${selected.length}] Memproses: ${m.title}...`);
        await processSingleClip(m.startSec, m.endSec, m.title, transcriptSegments);
      }
      setProgressPercent(100);
      setProgressStage(`Semua ${selected.length} clip selesai di-generate!`);
      setSuccess(true);
      fetchClips();
      setTimeout(() => setSuccess(false), 7000);
    } catch (e: any) {
      const msg = e.message || '';
      if (/failed to fetch|network error|networkerror|econnrefused/i.test(msg)) {
        setError('Koneksi ke backend (port 3002) terputus. Pastikan server backend sedang berjalan.');
      } else {
        setError(msg || 'Gagal melakukan batch generate');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Clip satu segmen game (pecah per game, VOD turnamen)
  const handleClipGameSegment = async (gameIdx: number) => {
    if (gameBreaks.length === 0) return;
    const startSec = Math.max(0, gameBreaks[gameIdx].time);
    const nextBreak = gameBreaks[gameIdx + 1];
    const videoEnd = transcriptSegments.length > 0
      ? Math.max(...transcriptSegments.map((s: any) => Number(s.end) || 0))
      : startSec + 1800;
    const endSec = nextBreak ? nextBreak.time : Math.floor(videoEnd);
    if (endSec <= startSec) {
      setError('Segmen game tidak valid (batas akhir <= awal)');
      return;
    }
    const gameTitle = `Game ${gameIdx + 1} - ${videoTitle || 'Match'}`;
    setLoading(true);
    setError('');
    setSuccess(false);
    try {
      setProgressStage(`Memotong Game ${gameIdx + 1} (${formatSec(startSec)} - ${formatSec(endSec)})...`);
      await processSingleClip(startSec, endSec, gameTitle, transcriptSegments);
      setProgressPercent(100);
      setProgressStage(`Game ${gameIdx + 1} selesai dipotong!`);
      setSuccess(true);
      fetchClips();
      setTimeout(() => setSuccess(false), 6000);
    } catch (e: any) {
      setError(e.message || 'Gagal memotong segmen game');
    } finally {
      setLoading(false);
    }
  };

  // ── Generate Single AI Moment
  const handleGenerateSingleMoment = async (m: ViralMoment) => {
    setLoading(true);
    setError('');
    setSuccess(false);
    try {
      await processSingleClip(m.startSec, m.endSec, m.title, transcriptSegments);
      setProgressPercent(100);
      setProgressStage('Clip selesai!');
      setSuccess(true);
      fetchClips();
      setTimeout(() => setSuccess(false), 6000);
    } catch (e: any) {
      const msg = e.message || '';
      if (/failed to fetch|network error|networkerror|econnrefused/i.test(msg)) {
        setError('Koneksi ke backend (port 3002) terputus. Pastikan server backend sedang berjalan.');
      } else {
        setError(msg || 'Gagal memproses clip');
      }
    } finally {
      setLoading(false);
    }
  };

  const deleteClip = async (id: string) => {
    if (!confirm('Hapus clip ini?')) return;
    try {
      await fetch(`${API}/api/clips/${id}`, { method: 'DELETE' });
      fetchClips();
    } catch { /* ignore */ }
  };

  const downloadClip = (clip: ClipMeta) => {
    const downloadUrl = `${API}/api/clips/${clip.id}`;
    if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
      try {
        chrome.downloads.download({
          url: downloadUrl,
          filename: clip.filename,
          saveAs: false,
        });
        return;
      } catch (err) {
        console.warn('Chrome downloads API error, falling back to anchor:', err);
      }
    }
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = clip.filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch {}
    }, 150);
  };

  const analyzeVirality = async (clip: ClipMeta) => {
    setLoadingVirality(clip.id);
    try {
      await fetch(`${API}/api/clips/${clip.id}/virality`);
      fetchClips();
    } catch { /* ignore */ }
    setLoadingVirality(null);
  };

  const transcribeClip = async (clip: ClipMeta) => {
    setTranscriptClipId(clip.id);
    setTranscript('');
    setLoadingTranscript(true);
    try {
      const r = await fetch(`${API}/api/clips/${clip.id}/transcribe`, { method: 'POST' });
      const data = await r.json();
      setTranscript(data.transcript || '');
      fetchClips();
    } catch { setTranscript('Gagal mendapatkan transkripsi.'); }
    setLoadingTranscript(false);
  };

  const togglePlatform = (key: Platform) => {
    setEnabledPlatforms(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const selectedClip = clips.find(c => c.id === selectedClipId) || null;

  useEffect(() => {
    if (selectedClip) {
      const clipChannel = (selectedClip as any).channel || '';
      if (clipChannel && !channelName) {
        setChannelName(clipChannel);
      }
      const activeCh = channelName || clipChannel;
      const chTag = activeCh ? ` #${activeCh.trim().replace(/\s+/g, '')}` : '';
      setUploadTitle(selectedClip.title ? `${selectedClip.title.slice(0, 80)} #Shorts` : '');
      setUploadDesc(selectedClip.transcript ? `Momen seru: ${selectedClip.title}\n\nJangan lupa like, komen, dan subscribe untuk video seru lainnya!` : 'Tonton video seru ini!');
      setUploadTags(`#Shorts #YouTubeShorts${chTag} #Viral #FYP #Trending`);
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
          platform: 'youtube',
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
        setUploadStatusMsg('✨ Judul viral, deskripsi kontekstual & hashtag channel berhasil dibuat AI!');
      }
    } catch (e: any) {
      setUploadStatusMsg(`❌ ${e.message}`);
    } finally {
      setGeneratingCaption(false);
    }
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
      chrome.storage.local.set({ yt_clipper_pending_upload: payload });
    }
    try {
      localStorage.setItem('yt_clipper_pending_upload', JSON.stringify(payload));
    } catch {}

    // Backup lokal ke disk (opsional) — upload Studio tidak membutuhkannya
    // karena ekstensi mengambil file langsung dari server via fetch.
    if (saveDiskBackup) downloadClip(selectedClip);

    setTimeout(() => {
      window.open('https://studio.youtube.com/channel/UC/videos/upload?d=pt', '_blank');
    }, 500);

    setUploadStatusMsg(
      autoPublishMode
        ? '🚀 YouTube Studio dibuka! Ekstensi otomatis menginjeksi file video, mengisi Judul & Deskripsi, serta menekan "Berikutnya" hingga video selesai dipublikasikan.'
        : '🚀 YouTube Studio dibuka! Ekstensi otomatis menginjeksi video & mengisi form, lalu menunggu Anda memeriksa sebelum klik Publikasikan.'
    );
  };

  const handleCopyAllCaption = () => {
    const full = `${uploadTitle}\n\n${uploadDesc}\n\n${uploadTags}`.trim();
    navigator.clipboard.writeText(full);
    setUploadStatusMsg('📋 Judul, deskripsi, dan hashtag disalin ke clipboard!');
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
    return target.toISOString().slice(0, 16);
  };

  const formatScheduleDisplay = (isoStr: string): string => {
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch {
      return isoStr;
    }
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
        setUploadStatusMsg(`✨ Berhasil membuat judul viral & caption AI untuk ${Object.keys(data.results).length} video antrean!`);
      }
    } catch (e: any) {
      setUploadStatusMsg(`❌ ${e.message}`);
    } finally {
      setGeneratingBatchCaptions(false);
    }
  };

  const handleStartBatchUpload = async () => {
    if (selectedBatchClipIds.length === 0) {
      setUploadStatusMsg('⚠️ Pilih minimal 1 video untuk antrean jadwal.');
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
      chrome.storage.local.set({ yt_clipper_pending_upload: items[0] });
    }

    // Backup lokal ke disk (opsional) — upload Studio mengambil file
    // langsung dari server, jadi backup ini tidak wajib.
    if (saveDiskBackup) {
      const firstClip = clips.find(c => c.id === selectedBatchClipIds[0]);
      if (firstClip) downloadClip(firstClip);
    }

    setTimeout(() => {
      window.open('https://studio.youtube.com/channel/UC/videos/upload?d=pt', '_blank');
    }, 500);

    setUploadStatusMsg(
      `🚀 Antrean ${items.length} video berhasil dibuat! Tab YouTube Studio dibuka dan ekstensi akan mengupload serta menjadwalkan setiap video satu per satu secara otomatis.`
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


  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const ViralityBadge = ({ virality }: { virality: ClipMeta['virality'] }) => {
    if (!virality) return null;
    const cls = `virality-badge virality-${virality.grade}`;
    return <span className={cls}>{virality.total}/100</span>;
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="app-logo">✂️</div>
        <div className="app-header-text">
          <h1>YT Short Clipper</h1>
          <p>Auto viral clip & dynamic captions</p>
        </div>
        <button
          className="settings-icon-btn"
          onClick={() => { setShowSettings(!showSettings); setSettingsMsg(''); }}
          title="Pengaturan API Key AI"
        >
          ⚙️
        </button>
      </header>

      {/* Settings Modal */}
      {showSettings && (
        <div className="card settings-card animate-in">
          <div className="section-header">
            <h3>⚙️ Pengaturan AI Key</h3>
            <p className="section-desc">Gunakan Groq API (Gratis & Cepat 1-2 detik) atau OpenAI untuk transkripsi dan deteksi momen viral.</p>
          </div>
          <form onSubmit={saveSettings} className="settings-form">
            <div className="input-group">
              <label>AI Provider</label>
              <div className="pill-group">
                <button
                  type="button"
                  className={`pill-btn ${aiProvider === 'groq' ? 'active' : ''}`}
                  onClick={() => setAiProvider('groq')}
                >
                  <span className="pill-icon">⚡</span>
                  <div className="pill-text">
                    <span className="pill-title">Groq (Gratis)</span>
                    <span className="pill-desc">Super cepat & akurat</span>
                  </div>
                </button>
                <button
                  type="button"
                  className={`pill-btn ${aiProvider === 'openai' ? 'active' : ''}`}
                  onClick={() => setAiProvider('openai')}
                >
                  <span className="pill-icon">🤖</span>
                  <div className="pill-text">
                    <span className="pill-title">OpenAI</span>
                    <span className="pill-desc">Whisper + GPT-4o</span>
                  </div>
                </button>
              </div>
            </div>

            {aiProvider === 'groq' && (
              <div className="input-group">
                <label>Groq API Key</label>
                <div className="input-wrapper">
                  <span className="input-icon">🔑</span>
                  <input
                    type="password"
                    value={groqKeyInput}
                    onChange={e => setGroqKeyInput(e.target.value)}
                    placeholder="gsk_..."
                  />
                </div>
                <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="api-link">
                  🔗 Ambil Groq API Key Gratis di console.groq.com →
                </a>
              </div>
            )}

            {aiProvider === 'openai' && (
              <div className="input-group">
                <label>OpenAI API Key</label>
                <div className="input-wrapper">
                  <span className="input-icon">🔑</span>
                  <input
                    type="password"
                    value={openaiKeyInput}
                    onChange={e => setOpenaiKeyInput(e.target.value)}
                    placeholder="sk-..."
                  />
                </div>
              </div>
            )}

            {settingsMsg && <p className="settings-feedback">{settingsMsg}</p>}

            <div className="settings-actions">
              <button type="submit" className="submit-btn save-btn">Simpan Pengaturan</button>
              <button type="button" className="ghost-btn" onClick={() => setShowSettings(false)}>Tutup</button>
            </div>
          </form>
        </div>
      )}

      {/* Tab Navigation */}
      <nav className="tab-nav">
        {([['create', '✂️', 'Buat'], ['history', '📋', 'Histori'], ['upload', '🚀', 'Upload']] as const).map(([key, icon, label]) => (
          <button
            key={key}
            className={`tab-btn ${tab === key ? 'active' : ''}`}
            onClick={() => { setTab(key as Tab); if (key === 'history') fetchClips(); }}
          >
            <span className="tab-icon">{icon}</span>
            {label}
            {key === 'history' && clips.length > 0 && <span className="tab-badge">{clips.length}</span>}
          </button>
        ))}
      </nav>

      {/* ═══ CREATE TAB ═══ */}
      {tab === 'create' && (
        <div className="card animate-in">
          {/* Mode Switcher: Auto AI vs Manual */}
          <div className="mode-switcher">
            <button
              className={`mode-btn ${createMode === 'auto' ? 'active' : ''}`}
              onClick={() => setCreateMode('auto')}
            >
              ⚡ Auto AI Viral Clips
            </button>
            <button
              className={`mode-btn ${createMode === 'manual' ? 'active' : ''}`}
              onClick={() => setCreateMode('manual')}
            >
              ✂️ Manual Clip
            </button>
          </div>

          <div className="clip-form">
            {/* YouTube URL */}
            <div className="input-group">
              <label htmlFor="yt-url">YouTube URL</label>
              <div className="input-wrapper">
                <span className="input-icon">🔗</span>
                <input
                  id="yt-url"
                  type="url"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  required
                  placeholder="https://youtube.com/watch?v=..."
                />
              </div>
            </div>

            {/* Manual Mode Time Row */}
            {createMode === 'manual' && (
              <div className="input-group">
                <div className="label-with-duration">
                  <label>Waktu Clip <span className="input-hint">— format mm:ss atau detik</span></label>
                  {(() => {
                    const s = parseTime(start);
                    const e = parseTime(end);
                    if (!isNaN(s) && !isNaN(e) && e > s) {
                      const dur = Math.round(e - s);
                      return (
                        <span className="manual-duration-badge">
                          ⏱️ Durasi: <strong>{dur}s</strong> ({formatSec(dur)})
                        </span>
                      );
                    }
                    return null;
                  })()}
                </div>
                <div className="time-row">
                  <div className="time-input-col">
                    <span className="time-sublabel">▶️ Mulai:</span>
                    <div className="input-wrapper">
                      <span className="input-icon">⏱️</span>
                      <input type="text" value={start} onChange={e => setStart(e.target.value)} required placeholder="0:00" />
                    </div>
                  </div>
                  <div className="time-input-col">
                    <span className="time-sublabel">⏹️ Selesai:</span>
                    <div className="input-wrapper">
                      <span className="input-icon">🏁</span>
                      <input type="text" value={end} onChange={e => setEnd(e.target.value)} required placeholder="0:45" />
                    </div>
                  </div>
                </div>

                {/* Quick duration presets */}
                <div className="manual-preset-row">
                  <span className="preset-label">Preset Durasi:</span>
                  <div className="preset-pill-group">
                    {[15, 30, 45, 60, 90, 120].map(s => (
                      <button
                        key={s}
                        type="button"
                        className="preset-btn"
                        onClick={() => applyManualDurationPreset(s)}
                        title={`Set durasi persis ${s} detik`}
                      >
                        {s}s
                      </button>
                    ))}
                  </div>
                  <div className="preset-nudge-group">
                    <button type="button" className="preset-nudge-btn" onClick={() => nudgeManualEnd(-5)} title="Kurangi 5 detik">-5s</button>
                    <button type="button" className="preset-nudge-btn" onClick={() => nudgeManualEnd(5)} title="Tambah 5 detik">+5s</button>
                    <button type="button" className="preset-nudge-btn" onClick={() => nudgeManualEnd(15)} title="Tambah 15 detik">+15s</button>
                  </div>
                </div>
              </div>
            )}

            {/* Auto AI Mode Duration Preference */}
            {createMode === 'auto' && (
              <div className="input-group">
                <label>Target Durasi Klip AI <span className="input-hint">— fleksibel & tidak harus 30 detik</span></label>
                <div className="pill-group pill-group-grid duration-pills">
                  <button
                    type="button"
                    className={`pill-btn ${targetDuration === 'auto' ? 'active' : ''}`}
                    onClick={() => setTargetDuration('auto')}
                  >
                    <span className="pill-icon">🔄</span>
                    <div className="pill-text">
                      <span className="pill-title">Bebas / Alami (15s–90s)</span>
                      <span className="pill-desc">AI potong utuh sesuai konteks cerita</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`pill-btn ${targetDuration === 'short' ? 'active' : ''}`}
                    onClick={() => setTargetDuration('short')}
                  >
                    <span className="pill-icon">⚡</span>
                    <div className="pill-text">
                      <span className="pill-title">Pendek (15s–30s)</span>
                      <span className="pill-desc">Hook kilat & punchline cepat</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`pill-btn ${targetDuration === 'medium' ? 'active' : ''}`}
                    onClick={() => setTargetDuration('medium')}
                  >
                    <span className="pill-icon">⏱️</span>
                    <div className="pill-text">
                      <span className="pill-title">Standar (30s–60s)</span>
                      <span className="pill-desc">Optimal YouTube Shorts & TikTok</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`pill-btn ${targetDuration === 'long' ? 'active' : ''}`}
                    onClick={() => setTargetDuration('long')}
                  >
                    <span className="pill-icon">📖</span>
                    <div className="pill-text">
                      <span className="pill-title">Panjang (60s–120s)</span>
                      <span className="pill-desc">Storytelling & podcast clip</span>
                    </div>
                  </button>
                </div>

                {/* Custom Duration Range Switch */}
                <div className="custom-duration-toggle-row">
                  <button
                    type="button"
                    className={`custom-toggle-btn ${targetDuration === 'custom' ? 'active' : ''}`}
                    onClick={() => setTargetDuration(targetDuration === 'custom' ? 'auto' : 'custom')}
                  >
                    <span>⚙️</span> {targetDuration === 'custom' ? 'Tutup Custom Rentang' : 'Atur Rentang Detik Sendiri (Custom)'}
                  </button>
                </div>

                {targetDuration === 'custom' && (
                  <div className="custom-duration-box animate-in">
                    <div className="custom-duration-inputs">
                      <div className="custom-input-col">
                        <span className="custom-dur-label">Min Detik:</span>
                        <input
                          type="number"
                          value={customMinDuration}
                          onChange={e => setCustomMinDuration(Math.max(5, parseInt(e.target.value) || 10))}
                          min={5}
                          max={customMaxDuration - 1}
                          className="custom-dur-input"
                        />
                      </div>
                      <span className="custom-dur-separator">sampai</span>
                      <div className="custom-input-col">
                        <span className="custom-dur-label">Max Detik:</span>
                        <input
                          type="number"
                          value={customMaxDuration}
                          onChange={e => setCustomMaxDuration(Math.max(customMinDuration + 5, parseInt(e.target.value) || 60))}
                          min={customMinDuration + 1}
                          max={2700}
                          className="custom-dur-input"
                        />
                      </div>
                    </div>
                    <p className="custom-dur-hint">AI akan mencari momen viral dengan durasi antara {customMinDuration}s sampai {customMaxDuration}s. Untuk potongan game panjang (s/d 45 menit), isi max hingga 2700.</p>
                  </div>
                )}
              </div>
            )}

            {/* Jumlah Momen AI */}
            {createMode === 'auto' && (
              <div className="input-group">
                <label>Jumlah Momen Viral <span className="input-hint">— maks hasil analisis AI</span></label>
                <div className="interval-pills">
                  {[5, 10, 15, 20, 30, 50].map(n => (
                    <button
                      key={n}
                      type="button"
                      className={`interval-pill ${maxMoments === n ? 'active' : ''}`}
                      onClick={() => setMaxMoments(n)}
                    >
                      {n} momen
                    </button>
                  ))}
                </div>
                <label className="matchmode-toggle" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={matchMode}
                    onChange={() => {
                      const next = !matchMode;
                      setMatchMode(next);
                      if (next && maxMoments < 20) setMaxMoments(20);
                    }}
                  />
                  <span>🏟️ Mode Turnamen (VOD 90+ menit: analisis full durasi + deteksi batas antar game)</span>
                </label>
              </div>
            )}

            {/* Framing & Quality Pills */}
            <div className="input-group">
              <label>Penyesuaian Framing <span className="input-hint">— 9:16 Shorts/TikTok atau 16:9 video reguler</span></label>
              <div className="pill-group pill-group-grid">
                <button
                  type="button"
                  className={`pill-btn ${framing === 'smart' ? 'active' : ''}`}
                  onClick={() => setFraming('smart')}
                >
                  <span className="pill-icon">🤖</span>
                  <div className="pill-text">
                    <span className="pill-title">Smart Auto-Crop</span>
                    <span className="pill-desc">Fokus otomatis ke wajah</span>
                  </div>
                </button>
                <button
                  type="button"
                  className={`pill-btn ${framing === 'streamer' ? 'active' : ''}`}
                  onClick={() => setFraming('streamer')}
                >
                  <span className="pill-icon">🎮</span>
                  <div className="pill-text">
                    <span className="pill-title">Mode Streamer</span>
                    <span className="pill-desc">Split: Facecam + Game</span>
                  </div>
                </button>
                <button
                  type="button"
                  className={`pill-btn ${framing === 'blur' ? 'active' : ''}`}
                  onClick={() => setFraming('blur')}
                >
                  <span className="pill-icon">🌫️</span>
                  <div className="pill-text">
                    <span className="pill-title">Blur Background</span>
                    <span className="pill-desc">Video utuh + latar blur</span>
                  </div>
                </button>
                <button
                  type="button"
                  className={`pill-btn ${framing === 'crop' ? 'active' : ''}`}
                  onClick={() => setFraming('crop')}
                >
                  <span className="pill-icon">✂️</span>
                  <div className="pill-text">
                    <span className="pill-title">Crop Tengah</span>
                    <span className="pill-desc">Potong 9:16 tepat di tengah</span>
                  </div>
                </button>
                <button
                  type="button"
                  className={`pill-btn ${framing === 'landscape' ? 'active' : ''}`}
                  onClick={() => setFraming('landscape')}
                >
                  <span className="pill-icon">📐</span>
                  <div className="pill-text">
                    <span className="pill-title">Landscape 16:9</span>
                    <span className="pill-desc">Potongan game / video reguler</span>
                  </div>
                </button>
              </div>

              {/* Streamer Facecam Position Selector */}
              {framing === 'streamer' && (
                <div className="streamer-facecam-box animate-in">
                  <div className="streamer-facecam-header">
                    <span className="facecam-icon">🎯</span>
                    <div className="facecam-info">
                      <span className="facecam-title">Posisi Facecam Streamer (Video Asli):</span>
                      <span className="facecam-desc">Pilih pojok kamera streamer atau biarkan AI mendeteksi otomatis</span>
                    </div>
                  </div>
                  <div className="corner-options">
                    <button
                      type="button"
                      className={`corner-btn ${facecamPos === 'auto' ? 'active' : ''}`}
                      onClick={() => setFacecamPos('auto')}
                    >
                      <span>🎯</span> Auto (Deteksi AI)
                    </button>
                    <button
                      type="button"
                      className={`corner-btn ${facecamPos === 'bottom-right' ? 'active' : ''}`}
                      onClick={() => setFacecamPos('bottom-right')}
                    >
                      <span>↘️</span> Kanan Bawah
                    </button>
                    <button
                      type="button"
                      className={`corner-btn ${facecamPos === 'bottom-left' ? 'active' : ''}`}
                      onClick={() => setFacecamPos('bottom-left')}
                    >
                      <span>↙️</span> Kiri Bawah
                    </button>
                    <button
                      type="button"
                      className={`corner-btn ${facecamPos === 'top-right' ? 'active' : ''}`}
                      onClick={() => setFacecamPos('top-right')}
                    >
                      <span>↗️</span> Kanan Atas
                    </button>
                    <button
                      type="button"
                      className={`corner-btn ${facecamPos === 'top-left' ? 'active' : ''}`}
                      onClick={() => setFacecamPos('top-left')}
                    >
                      <span>↖️</span> Kiri Atas
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="input-group">
              <label>Kualitas Output</label>
              <div className="pill-group">
                <button
                  type="button"
                  className={`pill-btn ${quality === '1080p' ? 'active' : ''}`}
                  onClick={() => setQuality('1080p')}
                >
                  <span className="pill-icon">💎</span>
                  <div className="pill-text">
                    <span className="pill-title">1080p Full HD</span>
                    <span className="pill-desc">Kualitas terbaik</span>
                  </div>
                </button>
                <button
                  type="button"
                  className={`pill-btn ${quality === '720p' ? 'active' : ''}`}
                  onClick={() => setQuality('720p')}
                >
                  <span className="pill-icon">⚡</span>
                  <div className="pill-text">
                    <span className="pill-title">720p HD</span>
                    <span className="pill-desc">Render cepat</span>
                  </div>
                </button>
              </div>
            </div>

            {/* Burn-in Captions Toggle */}
            <div className="caption-toggle-row">
              <div className="caption-toggle-info">
                <span className="caption-icon">🔤</span>
                <div>
                  <span className="caption-title">Teks Caption Video (TikTok Style)</span>
                  <span className="caption-desc">Render teks kata-kata tebal & dinamis di video</span>
                </div>
              </div>
              <button
                type="button"
                className={`toggle-switch ${burnCaptions ? 'on' : ''}`}
                onClick={() => setBurnCaptions(!burnCaptions)}
              >
                <span className="toggle-knob" />
              </button>
            </div>

            {/* Caption Vertical Position Selector */}
            {burnCaptions && (
              <div className="caption-pos-group animate-in">
                <div className="label-row">
                  <label>Posisi Teks Transcript</label>
                  <span className="input-hint">— dipindahkan ke atas agar tidak menutupi orang</span>
                </div>
                <div className="caption-pos-options">
                  <button
                    type="button"
                    className={`pos-btn ${captionPos === 'middle' ? 'active' : ''}`}
                    onClick={() => setCaptionPos('middle')}
                  >
                    <span className="pos-btn-icon">🎯</span>
                    <div className="pos-btn-text">
                      <span className="pos-btn-title">Tengah (Aman)</span>
                      <span className="pos-btn-desc">Diangkat di atas orang & bebas UI</span>
                    </div>
                    <span className="pos-badge-rec">Default</span>
                  </button>

                  <button
                    type="button"
                    className={`pos-btn ${captionPos === 'top' ? 'active' : ''}`}
                    onClick={() => setCaptionPos('top')}
                  >
                    <span className="pos-btn-icon">⬆️</span>
                    <div className="pos-btn-text">
                      <span className="pos-btn-title">Atas</span>
                      <span className="pos-btn-desc">Di sepertiga atas layar video</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    className={`pos-btn ${captionPos === 'bottom' ? 'active' : ''}`}
                    onClick={() => setCaptionPos('bottom')}
                  >
                    <span className="pos-btn-icon">⬇️</span>
                    <div className="pos-btn-text">
                      <span className="pos-btn-title">Bawah (Dinaikkan)</span>
                      <span className="pos-btn-desc">Di atas batas navigasi TikTok/Shorts</span>
                    </div>
                  </button>
                </div>
              </div>
            )}

            <div className="form-divider" />

            {/* Action Buttons */}
            {createMode === 'auto' ? (
              <button
                type="button"
                className="submit-btn ai-btn"
                onClick={handleAutoDetect}
                disabled={detectingMoments || loading}
              >
                {detectingMoments ? (
                  <>
                    <span className="spinner" />
                    AI Menganalisis Video ({progressPercent}%)
                  </>
                ) : (
                  <>
                    <span className="btn-icon">✨</span>
                    Analisis Momen Viral AI
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                className="submit-btn"
                onClick={handleManualSubmit}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="spinner" />
                    Memproses ({progressPercent}%)
                  </>
                ) : (
                  <>
                    <span className="btn-icon">✂️</span>
                    Generate Clip
                  </>
                )}
              </button>
            )}

            {/* Progress Section */}
            {(loading || detectingMoments) && (
              <div className="progress-section">
                <div className="progress-header-row">
                  <span className="progress-stage-text">{progressStage || 'Memproses...'}</span>
                  <span className="progress-percent-number">{progressPercent}%</span>
                </div>
                <div className="progress-bar-track">
                  <div className="progress-bar-fill-determinate" style={{ width: `${Math.min(100, Math.max(5, progressPercent))}%` }} />
                </div>
              </div>
            )}

            {error && <div className="error-msg"><span className="error-icon">⚠️</span><span>{error}</span></div>}
            {success && <div className="success-msg"><span>✅</span><span>{progressStage || 'Berhasil! File diunduh & tersimpan di Histori.'}</span></div>}

            {/* ═══ Detected Viral Moments List (Auto AI Mode) ═══ */}
            {createMode === 'auto' && detectedMoments.length > 0 && (
              <div className="viral-moments-section animate-in">
                <div className="viral-section-header">
                  <div>
                    <h4>🔥 {detectedMoments.length} Momen Viral Terdeteksi</h4>
                    <p className="viral-video-title">{videoTitle}</p>
                  </div>
                  <button
                    type="button"
                    className="submit-btn batch-all-btn"
                    onClick={handleBatchGenerate}
                    disabled={loading}
                  >
                    🚀 Generate Semua
                  </button>
                </div>

                {/* ═══ Batas Antar Game (Mode Turnamen) ═══ */}
                {gameBreaks.length > 0 && (
                  <div className="game-breaks-section animate-in" style={{ marginBottom: '14px' }}>
                    <h4>🏟️ {gameBreaks.length} Batas Game Terdeteksi</h4>
                    <p className="viral-video-title">Potong per game (format mengikuti framing aktif: {framing === 'landscape' ? '16:9' : '9:16'})</p>
                    <div className="moments-list">
                      {gameBreaks.map((g, idx) => {
                        const nextBreak = gameBreaks[idx + 1];
                        const videoEnd = transcriptSegments.length > 0
                          ? Math.max(...transcriptSegments.map((s: any) => Number(s.end) || 0))
                          : g.time;
                        const segEnd = nextBreak ? nextBreak.time : Math.floor(videoEnd);
                        return (
                          <div key={`game-${idx}`} className="moment-card">
                            <div className="moment-header">
                              <span className="moment-index">G{idx + 1}</span>
                              <h4 className="moment-title">{g.label}</h4>
                              <span className="moment-duration-pill">
                                ⏱️ {formatSec(g.time)} → {formatSec(segEnd)}
                              </span>
                            </div>
                            <button
                              type="button"
                              className="ghost-btn ghost-btn-sm moment-clip-btn"
                              onClick={() => handleClipGameSegment(idx)}
                              disabled={loading}
                            >
                              ✂️ Potong Game {idx + 1}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="moments-list">
                  {detectedMoments.slice(0, visibleMomentCount).map((m, idx) => (
                    <div key={idx} className="moment-card">
                      <div className="moment-header">
                        <input
                          type="checkbox"
                          checked={m.selected}
                          onChange={() => {
                            const updated = [...detectedMoments];
                            updated[idx].selected = !updated[idx].selected;
                            setDetectedMoments(updated);
                          }}
                          className="moment-checkbox"
                        />
                        <span className="moment-index">#{idx + 1}</span>
                        <h4 className="moment-title">{m.title}</h4>
                        <span className="moment-score">{m.viralityScore}/100 🔥</span>
                      </div>

                      <div className="moment-trim-section">
                        <div className="moment-duration-row">
                          <span className="moment-duration-pill">
                            ⏱️ Durasi: <strong>{m.duration}s</strong> ({formatSec(m.startSec)} - {formatSec(m.endSec)})
                          </span>
                          <div className="moment-quick-nudge">
                            <span className="nudge-title">Panjang Klip:</span>
                            <button type="button" className="nudge-btn" onClick={() => updateMomentDuration(idx, -5)} title="Kurangi 5 detik">-5s</button>
                            <button type="button" className="nudge-btn" onClick={() => updateMomentDuration(idx, 5)} title="Tambah 5 detik">+5s</button>
                            <button type="button" className="nudge-btn" onClick={() => updateMomentDuration(idx, 15)} title="Tambah 15 detik">+15s</button>
                          </div>
                        </div>

                        {/* Fine tuning Start & End */}
                        <div className="moment-steppers-row">
                          <div className="stepper-item">
                            <span className="stepper-label">Mulai:</span>
                            <div className="stepper-controls">
                              <button type="button" className="stepper-btn" onClick={() => updateMomentTime(idx, m.startSec - 5, m.endSec)}>-5s</button>
                              <button type="button" className="stepper-btn" onClick={() => updateMomentTime(idx, m.startSec - 1, m.endSec)}>-1s</button>
                              <span className="stepper-value">{formatSec(m.startSec)}</span>
                              <button type="button" className="stepper-btn" onClick={() => updateMomentTime(idx, m.startSec + 1, m.endSec)}>+1s</button>
                              <button type="button" className="stepper-btn" onClick={() => updateMomentTime(idx, m.startSec + 5, m.endSec)}>+5s</button>
                            </div>
                          </div>
                          <div className="stepper-item">
                            <span className="stepper-label">Selesai:</span>
                            <div className="stepper-controls">
                              <button type="button" className="stepper-btn" onClick={() => updateMomentTime(idx, m.startSec, m.endSec - 5)}>-5s</button>
                              <button type="button" className="stepper-btn" onClick={() => updateMomentTime(idx, m.startSec, m.endSec - 1)}>-1s</button>
                              <span className="stepper-value">{formatSec(m.endSec)}</span>
                              <button type="button" className="stepper-btn" onClick={() => updateMomentTime(idx, m.startSec, m.endSec + 1)}>+1s</button>
                              <button type="button" className="stepper-btn" onClick={() => updateMomentTime(idx, m.startSec, m.endSec + 5)}>+5s</button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {m.hook && (
                        <p className="moment-hook">
                          <strong>🎣 Hook:</strong> "{m.hook}"
                        </p>
                      )}

                      {m.reason && (
                        <p className="moment-reason">
                          💡 {m.reason}
                        </p>
                      )}

                      <button
                        type="button"
                        className="ghost-btn ghost-btn-sm moment-clip-btn"
                        onClick={() => handleGenerateSingleMoment(m)}
                        disabled={loading}
                      >
                        ✂️ Clip Momen Ini
                      </button>
                    </div>
                  ))}
                </div>
                {detectedMoments.length > visibleMomentCount && (
                  <button
                    type="button"
                    className="ghost-btn moment-clip-btn"
                    style={{ marginTop: '10px', width: '100%' }}
                    onClick={() => setVisibleMomentCount(c => c + 20)}
                  >
                    Tampilkan {Math.min(20, detectedMoments.length - visibleMomentCount)} lagi ({visibleMomentCount}/{detectedMoments.length})
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ HISTORY TAB ═══ */}
      {tab === 'history' && (
        <div className="history-panel animate-in">
          {loadingClips && <div className="loading-placeholder"><span className="spinner" /> Memuat daftar clip...</div>}

          {!loadingClips && clips.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon-wrap"><span className="empty-icon">📭</span></div>
              <h3>Belum ada clip</h3>
              <p>Buat clip pertama untuk memulai</p>
              <button className="ghost-btn" onClick={() => setTab('create')}>✂️ Buat Clip Pertama</button>
            </div>
          )}

          {clips.map(clip => (
            <div key={clip.id} className="clip-card">
              <div className="clip-card-header">
                <div className="clip-title-row">
                  <h3 className="clip-title">{clip.title}</h3>
                  {clip.virality && <ViralityBadge virality={clip.virality} />}
                </div>
                <div className="clip-tags-row">
                  <span className="clip-tag">⏱️ {clip.durationFormatted}</span>
                  <span className="clip-tag">📦 {clip.fileSizeMB} MB</span>
                  <span className="clip-tag">
                    {clip.framing === 'streamer' ? '🎮 Streamer' :
                     clip.framing === 'smart' ? '🤖 Smart Crop' :
                     clip.framing === 'landscape' ? '📐 Landscape' :
                     clip.framing === 'blur' ? '🌫️ Blur' : '✂️ Crop Tengah'}
                  </span>
                  <span className="clip-tag">{clip.quality || '1080p'}</span>
                  {clip.hasCaptions && <span className="clip-tag caption-tag">🔤 Subtitle</span>}
                  <span className="clip-tag">📅 {formatDate(clip.createdAt)}</span>
                </div>
              </div>

              {/* Video Preview Player */}
              {previewClipId === clip.id ? (
                <div className="video-player-container">
                  <video
                    src={`${API}/clips/${clip.filename}`}
                    controls
                    autoPlay
                    playsInline
                    className="clip-video-element"
                  />
                  <button className="ghost-btn ghost-btn-sm close-preview-btn" onClick={() => setPreviewClipId(null)}>
                    ✕ Tutup Player
                  </button>
                </div>
              ) : (
                <div className="preview-trigger-box" onClick={() => setPreviewClipId(clip.id)}>
                  <span className="play-icon-badge">▶</span>
                  <span>Tonton Preview Video</span>
                </div>
              )}

              {/* Virality details */}
              {clip.virality && (
                <div className="virality-details">
                  <div className="virality-bar-row">
                    <span className="virality-label">Skor</span>
                    <div className="virality-bar-track">
                      <div className="virality-bar-fill" style={{ width: `${clip.virality.total}%` }} />
                    </div>
                    <span className="virality-score">{clip.virality.total}</span>
                  </div>
                  {clip.virality.tips.map((tip, i) => (
                    <p key={i} className="virality-tip">💡 {tip}</p>
                  ))}
                </div>
              )}

              {/* Transcript */}
              {transcriptClipId === clip.id && (
                <div className="transcript-panel">
                  {loadingTranscript ? (
                    <div className="loading-placeholder"><span className="spinner-sm" /> Mengambil transkripsi...</div>
                  ) : (
                    <>
                      <p className="transcript-text">{transcript}</p>
                      <button className="ghost-btn ghost-btn-sm" onClick={() => navigator.clipboard.writeText(transcript)}>📋 Salin Teks</button>
                    </>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="clip-actions">
                <button className="action-btn" onClick={() => downloadClip(clip)} title="Download"><span>⬇️</span><span className="action-label">Download</span></button>
                <button className="action-btn" onClick={() => analyzeVirality(clip)} disabled={loadingVirality === clip.id} title="Viralitas">
                  {loadingVirality === clip.id ? <span className="spinner-sm" /> : <span>📊</span>}
                  <span className="action-label">Viral</span>
                </button>
                <button className="action-btn" onClick={() => { if (transcriptClipId === clip.id) setTranscriptClipId(null); else transcribeClip(clip); }} title="Transkripsi">
                  {loadingTranscript && transcriptClipId === clip.id ? <span className="spinner-sm" /> : <span>📝</span>}
                  <span className="action-label">Teks</span>
                </button>
                <button className="action-btn" onClick={() => { setSelectedClipId(clip.id); setTab('upload'); }} title="Upload"><span>🚀</span><span className="action-label">Upload</span></button>
                <button className="action-btn action-btn-danger" onClick={() => deleteClip(clip.id)} title="Hapus"><span>🗑️</span></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ UPLOAD TAB ═══ */}
      {tab === 'upload' && (
        <div className="upload-panel animate-in">
          {/* Toggle: tampilkan/sembunyikan seluruh section auto-upload */}
          <div className="card">
            <div className="platform-toggle-item">
              <div className="platform-toggle-info">
                <span className="platform-toggle-icon">🚀</span>
                <div>
                  <span className="platform-toggle-name">Auto-Upload ke YouTube Studio</span>
                  <span className="platform-toggle-desc">Tampilkan panel upload tunggal & batch schedule</span>
                </div>
              </div>
              <button
                type="button"
                className={`toggle-switch ${showAutoUpload ? 'on' : ''}`}
                onClick={() => setShowAutoUpload(prev => !prev)}
                aria-label="Toggle auto-upload"
              >
                <span className="toggle-knob" />
              </button>
            </div>
          </div>

          {showAutoUpload && (
          <>
          {/* Sub-tabs: Single vs Batch */}
          <div className="upload-subtabs">
            <button
              type="button"
              className={`subtab-btn ${uploadSubMode === 'single' ? 'active' : ''}`}
              onClick={() => setUploadSubMode('single')}
            >
              🎯 Upload Tunggal
            </button>
            <button
              type="button"
              className={`subtab-btn ${uploadSubMode === 'batch' ? 'active' : ''}`}
              onClick={() => {
                setUploadSubMode('batch');
                if (selectedBatchClipIds.length === 0 && clips.length > 0) {
                  setSelectedBatchClipIds(clips.map(c => c.id));
                }
              }}
            >
              📅 Batch Schedule (Banyak Video Sekaligus)
              {clips.length > 0 && <span className="batch-counter-badge">{clips.length}</span>}
            </button>
          </div>

          {/* SINGLE MODE */}
          {uploadSubMode === 'single' && (
            <>
              {/* Clip selector */}
              <div className="card">
                <div className="input-group">
                  <label>Pilih Clip</label>
                  <div className="custom-select-wrapper">
                    <select
                      className="custom-select"
                      value={selectedClipId}
                      onChange={e => setSelectedClipId(e.target.value)}
                    >
                      <option value="">-- Pilih clip --</option>
                      {clips.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.title} ({c.durationFormatted})
                        </option>
                      ))}
                    </select>
                    <span className="select-arrow">▾</span>
                  </div>
                </div>
              </div>

              {/* Platform toggles & YouTube Studio Auto-Upload */}
              {selectedClip && (
                <>
                  {/* YouTube Shorts Auto-Upload Card */}
                  <div className="card yt-upload-card animate-in">
                    <div className="section-header yt-card-header">
                      <div className="yt-badge-title">
                        <span className="yt-icon">🎬</span>
                        <div>
                          <h3>YouTube Shorts Auto-Uploader & Scheduler</h3>
                          <p className="section-desc">
                            Gunakan sesi login browser Anda. Video & form akan diisi otomatis di YouTube Studio.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="ai-caption-btn"
                        onClick={handleGenerateAICaption}
                        disabled={generatingCaption}
                      >
                        {generatingCaption ? (
                          <>
                            <span className="spinner-sm" /> Membuat Caption AI...
                          </>
                        ) : (
                          <>
                            <span>✨</span> Buat Caption & Tag AI
                          </>
                        )}
                      </button>
                    </div>

                    {uploadStatusMsg && (
                      <div className={`upload-status-alert ${uploadStatusMsg.startsWith('❌') ? 'alert-err' : 'alert-ok'}`}>
                        {uploadStatusMsg}
                      </div>
                    )}

                    <div className="caption-form">
                      {/* Channel / Creator Name */}
                      <div className="input-group">
                        <div className="label-row">
                          <label>Nama Channel / Kreator</label>
                          <span className="input-hint">— otomatis disertakan di hashtag & deskripsi</span>
                        </div>
                        <div className="input-wrapper">
                          <span className="input-icon">📢</span>
                          <input
                            type="text"
                            value={channelName}
                            onChange={e => {
                              setChannelName(e.target.value);
                              localStorage.setItem('yt_clipper_channel', e.target.value);
                            }}
                            placeholder="Nama channel Anda / kreator (contoh: Windah Basudara)..."
                          />
                        </div>
                      </div>

                      {/* Title */}
                      <div className="input-group">
                        <div className="label-row">
                          <label>Judul YouTube Shorts</label>
                          <span className="char-counter">{uploadTitle.length}/100</span>
                        </div>
                        <input
                          type="text"
                          className="caption-input"
                          value={uploadTitle}
                          onChange={e => setUploadTitle(e.target.value)}
                          placeholder="Judul video dengan hook menarik..."
                          maxLength={100}
                        />
                      </div>

                      {/* Description */}
                      <div className="input-group">
                        <label>Deskripsi Video</label>
                        <textarea
                          className="caption-textarea"
                          rows={3}
                          value={uploadDesc}
                          onChange={e => setUploadDesc(e.target.value)}
                          placeholder="Deskripsi kontekstual tentang isi video..."
                        />
                      </div>

                      {/* Hashtags */}
                      <div className="input-group">
                        <label>Hashtag Viral</label>
                        <input
                          type="text"
                          className="caption-input"
                          value={uploadTags}
                          onChange={e => setUploadTags(e.target.value)}
                          placeholder="#Shorts #FYP #Trending #Viral"
                        />
                      </div>

                      {/* Scheduling Switch */}
                      <div className="schedule-box">
                        <div className="schedule-header">
                          <div className="schedule-info">
                            <span className="schedule-icon">🕒</span>
                            <div>
                              <span className="schedule-title">Jadwalkan Publikasi (Schedule)</span>
                              <span className="schedule-desc">Atur tanggal & jam tayang otomatis di YouTube Studio</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            className={`toggle-switch ${isScheduleActive ? 'on' : ''}`}
                            onClick={() => setIsScheduleActive(!isScheduleActive)}
                          >
                            <span className="toggle-knob" />
                          </button>
                        </div>

                        {isScheduleActive && (
                          <div className="schedule-picker-row animate-in">
                            <label>Waktu Publikasi:</label>
                            <input
                              type="datetime-local"
                              className="schedule-datetime-input"
                              value={scheduleTime}
                              onChange={e => setScheduleTime(e.target.value)}
                            />
                          </div>
                        )}
                      </div>

                      {/* Auto-Publish Mode Selector */}
                      <div className="publish-mode-selector animate-in">
                        <label className="mode-label">Mode Otomatisasi YouTube Shorts:</label>
                        <div className="publish-mode-options">
                          <div
                            className={`publish-mode-card ${autoPublishMode ? 'selected' : ''}`}
                            onClick={() => setAutoPublishMode(true)}
                          >
                            <div className="mode-card-header">
                              <span className="mode-icon">🚀</span>
                              <span className="mode-title">Full Auto (Hands-Free)</span>
                              <span className="mode-badge-rec">Rekomendasi</span>
                            </div>
                            <p className="mode-desc">
                              Otomatis upload video, isi judul & deskripsi, klik 'Berikutnya' sampai 'Publikasikan' selesai 100%.
                            </p>
                          </div>

                          <div
                            className={`publish-mode-card ${!autoPublishMode ? 'selected' : ''}`}
                            onClick={() => setAutoPublishMode(false)}
                          >
                            <div className="mode-card-header">
                              <span className="mode-icon">🔍</span>
                              <span className="mode-title">Review Sebelum Terbit</span>
                            </div>
                            <p className="mode-desc">
                              Otomatis upload & isi form, lalu berhenti di langkah akhir agar Anda bisa cek sebelum klik Publikasikan.
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Upload Step-by-Step Guidance */}
                      <div className="upload-step-guide animate-in">
                        <div className="guide-header">
                          <span>🤖</span>
                          <strong>100% Otomatisasi YouTube Studio:</strong>
                        </div>
                        <p className="guide-text">
                          1. Klik tombol merah di bawah &rarr; Tab YouTube Studio terbuka.<br/>
                          2. Ekstensi otomatis <strong>menginjeksi file video klip</strong> ke YouTube Studio tanpa perlu drag manual.<br/>
                          3. Ekstensi otomatis <strong>mengisi Judul, Deskripsi, Hashtag #{channelName ? channelName.replace(/\s+/g, '') : 'Channel'}, Usia</strong>, lalu <strong>menekan 'Berikutnya' hingga video terupload & selesai</strong>!
                        </p>
                      </div>

                      {/* Action Buttons */}
                      <div className="yt-action-buttons">
                        <button
                          type="button"
                          className="submit-btn yt-direct-upload-btn"
                          onClick={handleUploadToYouTubeShorts}
                        >
                          <span>🚀</span> {autoPublishMode ? 'Auto-Upload & Publikasikan ke YouTube' : 'Auto-Upload & Review di YouTube'}
                        </button>
                        <button
                          type="button"
                          className="ghost-btn copy-all-btn"
                          onClick={handleCopyAllCaption}
                          title="Salin semua teks ke clipboard"
                        >
                          📋 Salin Teks
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Other Platforms Section */}
                  <div className="card">
                    <div className="section-header">
                      <h3>Platform Lainnya (TikTok, Instagram, Facebook)</h3>
                      <p className="section-desc">Aktifkan platform yang diinginkan untuk membuka tab upload simultan.</p>
                    </div>

                    <div className="platform-toggles">
                      {PLATFORMS.map(p => (
                        <div key={p.key} className={`platform-toggle-item ${enabledPlatforms[p.key] ? 'enabled' : ''}`}>
                          <div className="platform-toggle-info">
                            <span className="platform-toggle-icon">{p.icon}</span>
                            <div>
                              <span className="platform-toggle-name">{p.name}</span>
                              <span className="platform-toggle-desc">{p.desc}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            className={`toggle-switch ${enabledPlatforms[p.key] ? 'on' : ''}`}
                            onClick={() => togglePlatform(p.key)}
                            aria-label={`Toggle ${p.name}`}
                          >
                            <span className="toggle-knob" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Selected clip summary */}
                  <div className="card upload-summary">
                    <div className="upload-summary-clip">
                      <span className="upload-clip-icon">🎬</span>
                      <div>
                        <h4>{selectedClip.title}</h4>
                        <p>{selectedClip.durationFormatted} · {selectedClip.fileSizeMB} MB · {selectedClip.framing === 'blur' ? 'Blur BG' : 'Crop 9:16'}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="submit-btn upload-all-btn"
                      onClick={openAllPlatforms}
                      disabled={enabledCount === 0}
                    >
                      🚀 Upload ke {enabledCount} Platform Sekaligus
                    </button>

                    <p className="upload-note">
                      File clip akan diunduh otomatis, lalu tab upload platform terpilih akan dibuka. Kamu tinggal drag & drop videonya.
                    </p>
                  </div>
                </>
              )}

              {!selectedClip && clips.length === 0 && (
                <div className="empty-state">
                  <div className="empty-icon-wrap"><span className="empty-icon">📭</span></div>
                  <h3>Belum ada clip</h3>
                  <p>Buat clip dulu sebelum upload</p>
                  <button className="ghost-btn" onClick={() => setTab('create')}>✂️ Buat Clip</button>
                </div>
              )}

              {!selectedClip && clips.length > 0 && (
                <div className="empty-state">
                  <div className="empty-icon-wrap"><span className="empty-icon">☝️</span></div>
                  <h3>Pilih clip di atas</h3>
                  <p>Pilih clip dari dropdown untuk melihat opsi upload simultan</p>
                </div>
              )}
            </>
          )}

          {/* BATCH MODE */}
          {uploadSubMode === 'batch' && (
            <div className="batch-scheduler-card card animate-in">
              <div className="section-header yt-card-header">
                <div className="yt-badge-title">
                  <span className="yt-icon">🗓️</span>
                  <div>
                    <h3>Batch Scheduler & Multi-Video Auto Upload</h3>
                    <p className="section-desc">
                      Upload beberapa video sekaligus. Ekstensi YouTube Studio akan mengupload dan menjadwalkan satu per satu otomatis sesuai jam interval yang dipilih.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="ai-caption-btn"
                  onClick={handleGenerateBatchAICaptions}
                  disabled={generatingBatchCaptions || selectedBatchClipIds.length === 0}
                  title="Generate judul viral & tags AI untuk semua video terpilih"
                >
                  {generatingBatchCaptions ? (
                    <>
                      <span className="spinner-sm" /> Membuat AI Captions...
                    </>
                  ) : (
                    <>
                      <span>✨</span> Buat AI Captions Semua ({selectedBatchClipIds.length})
                    </>
                  )}
                </button>
              </div>

              {uploadStatusMsg && (
                <div className={`upload-status-alert ${uploadStatusMsg.startsWith('❌') || uploadStatusMsg.startsWith('⚠️') ? 'alert-err' : 'alert-ok'}`}>
                  {uploadStatusMsg}
                </div>
              )}

              {/* Batch Configuration Settings */}
              <div className="batch-config-grid">
                <div className="input-group">
                  <label>Mulai Jadwal Pertama (Start Time)</label>
                  <input
                    type="datetime-local"
                    className="schedule-datetime-input"
                    value={batchStartTime}
                    onChange={e => setBatchStartTime(e.target.value)}
                  />
                  <span className="input-hint">Waktu tayang video urutan pertama (#1)</span>
                </div>

                <div className="input-group">
                  <label>Interval Waktu Antar Video</label>
                  <div className="interval-pills">
                    {[1, 2, 3, 4, 6, 12, 24].map(hours => (
                      <button
                        key={hours}
                        type="button"
                        className={`interval-pill ${batchIntervalHours === hours ? 'active' : ''}`}
                        onClick={() => setBatchIntervalHours(hours)}
                      >
                        {hours === 24 ? '1 Hari' : `${hours} Jam`}
                      </button>
                    ))}
                  </div>
                  <span className="input-hint">Video berikutnya otomatis tayang tiap +{batchIntervalHours} jam</span>
                </div>

                <div className="input-group">
                  <label>Kuota Harian (ramah algoritma)</label>
                  <div className="interval-pills">
                    {[2, 3, 4].map(quota => (
                      <button
                        key={quota}
                        type="button"
                        className={`interval-pill ${batchDailyQuota === quota ? 'active' : ''}`}
                        onClick={() => setBatchDailyQuota(quota)}
                      >
                        {quota}/hari
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`interval-pill ${batchDailyQuota === 0 ? 'active' : ''}`}
                      onClick={() => setBatchDailyQuota(0)}
                    >
                      Tanpa batas
                    </button>
                  </div>
                  <span className="input-hint">
                    {batchDailyQuota > 0
                      ? `Maks ${batchDailyQuota} video/hari — antrean ${selectedBatchClipIds.length} video selesai dalam ${Math.max(1, Math.ceil(selectedBatchClipIds.length / batchDailyQuota))} hari`
                      : 'Tanpa batas harian — semua video dijadwalkan berurutan sesuai interval'}
                  </span>
                </div>
              </div>

              {/* Creator Name Field */}
              <div className="input-group">
                <div className="label-row">
                  <label>Nama Channel / Kreator</label>
                  <span className="input-hint">— disisipkan otomatis di tag setiap video</span>
                </div>
                <div className="input-wrapper">
                  <span className="input-icon">📢</span>
                  <input
                    type="text"
                    value={channelName}
                    onChange={e => {
                      setChannelName(e.target.value);
                      localStorage.setItem('yt_clipper_channel', e.target.value);
                    }}
                    placeholder="Nama channel Anda (contoh: Windah Basudara)..."
                  />
                </div>
              </div>

              {/* Queue Header & Select All */}
              <div className="batch-select-all-row">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={clips.length > 0 && selectedBatchClipIds.length === clips.length}
                    onChange={toggleSelectAllBatch}
                  />
                  <span>Pilih Semua Klip ({selectedBatchClipIds.length}/{clips.length})</span>
                </label>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Total {selectedBatchClipIds.length} video dalam antrean
                </span>
              </div>

              {/* Queue Items */}
              {clips.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon">📭</span>
                  <p>Belum ada clip yang dibuat di history.</p>
                  <button className="ghost-btn" onClick={() => setTab('create')}>✂️ Buat Clip Baru</button>
                </div>
              ) : (
                <div className="batch-queue-list">
                  {clips.map((clip) => {
                    const isSelected = selectedBatchClipIds.includes(clip.id);
                    const queueIndex = selectedBatchClipIds.indexOf(clip.id);
                    const schedTime = isSelected ? getClipScheduledTime(clip.id, queueIndex) : '';
                    const customCap = batchCaptions[clip.id];

                    return (
                      <div
                        key={clip.id}
                        className={`batch-queue-item ${isSelected ? 'selected' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectBatchClip(clip.id)}
                          style={{ marginTop: '5px', cursor: 'pointer' }}
                        />

                        {isSelected && (
                          <div className="queue-index-badge">
                            #{queueIndex + 1}
                          </div>
                        )}

                        <div className="queue-item-content">
                          <div className="queue-item-header">
                            <input
                              type="text"
                              className="queue-item-title-input"
                              value={customCap?.title || clip.title}
                              onChange={(e) => {
                                const val = e.target.value;
                                setBatchCaptions(prev => ({
                                  ...prev,
                                  [clip.id]: {
                                    ...(prev[clip.id] || {
                                      description: clip.transcript || 'Video Shorts seru!',
                                      hashtags: ['#Shorts', '#Viral'],
                                    }),
                                    title: val,
                                  }
                                }));
                              }}
                              placeholder="Judul YouTube Shorts..."
                            />
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {clip.durationFormatted}
                            </span>
                          </div>

                          {isSelected && (
                            <div className="queue-item-schedule-row">
                              <span className="schedule-pill-badge">
                                🕒 Jadwal: {formatScheduleDisplay(schedTime)}
                              </span>
                              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                Ubah jam:
                                <input
                                  type="datetime-local"
                                  className="edit-schedule-inline"
                                  value={schedTime}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setCustomClipSchedules(prev => ({ ...prev, [clip.id]: val }));
                                  }}
                                />
                              </label>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Guidance Box */}
              <div className="upload-step-guide animate-in">
                <div className="guide-header">
                  <span>🤖</span>
                  <strong>Bagaimana Batch Scheduler Berjalan Otomatis:</strong>
                </div>
                <p className="guide-text">
                  1. Ekstensi YouTube Studio akan membuka video pertama (#1), mengupload, mengisi Judul/Deskripsi/Tag, dan <strong>menyetel jadwal jam {formatScheduleDisplay(getClipScheduledTime(selectedBatchClipIds[0] || '', 0))}</strong>.<br/>
                  2. Saat video #1 selesai dijadwalkan, ekstensi otomatis <strong>melanjutkan ke video #2</strong> (+{batchIntervalHours} jam berikutnya{batchDailyQuota > 0 ? `, maks ${batchDailyQuota}/hari` : ''}), lalu #3, dan seterusnya sampai semua video selesai terjadwal tanpa perlu Anda klik berulang kali!
                </p>
              </div>

              {/* Submit Button */}
              <button
                type="button"
                className="submit-btn batch-all-btn"
                onClick={handleStartBatchUpload}
                disabled={selectedBatchClipIds.length === 0 || batchUploading}
              >
                {batchUploading ? '⏳ Mengirim antrean...' : `🚀 Jadwalkan & Upload ${selectedBatchClipIds.length} Video ke YouTube Studio`}
              </button>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-muted)', marginTop: '10px' }}>
                <input
                  type="checkbox"
                  checked={saveDiskBackup}
                  onChange={e => setSaveDiskBackup(e.target.checked)}
                />
                <span>Simpan juga backup ke disk (tidak wajib — upload Studio mengambil file langsung dari server)</span>
              </label>
            </div>
          )}
          </>
          )}
        </div>
      )}

      {/* Footer */}
      <footer className="app-footer">
        <p>YT Short Clipper v2.5 AI</p>
        <div className="footer-badge">
          <span className="dot" />
          Server terhubung · Port 3002
        </div>
      </footer>
    </div>
  );
}

export default App;
