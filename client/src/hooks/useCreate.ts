import { useState } from 'react';
import { postSse, BACKEND_OFFLINE_MSG, isBackendOfflineError } from '../lib/api';
import { parseTime, formatSec } from '../lib/format';
import type {
  ViralMoment, GameBreak, CreateMode, FramingMode, FacecamPosition,
  QualityMode, CaptionPosition,
} from '../types';

interface CreateDeps {
  fetchClips: () => void | Promise<void>;
  downloadClip: (clip: any) => void;
  groqKeyInput: string;
  openaiKeyInput: string;
  aiProvider: string;
  hasGroqKey: boolean;
  hasOpenaiKey: boolean;
  setShowSettings: (v: boolean) => void;
}

export function useCreate(deps: CreateDeps) {
  const { fetchClips, downloadClip, groqKeyInput, openaiKeyInput, aiProvider, hasGroqKey, hasOpenaiKey, setShowSettings } = deps;

  const [createMode, setCreateMode] = useState<CreateMode>('auto');
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

  // ── Mode turnamen (VOD panjang: skala limit + deteksi batas game)
  const [matchMode, setMatchMode] = useState<boolean>(false);
  const [gameBreaks, setGameBreaks] = useState<GameBreak[]>([]);
  const [visibleMomentCount, setVisibleMomentCount] = useState<number>(20);
  const [maxMoments, setMaxMoments] = useState<number>(10);

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

  const readCredentials = () => ({
    groq: localStorage.getItem('yt_clipper_groq_key') || groqKeyInput,
    openai: localStorage.getItem('yt_clipper_openai_key') || openaiKeyInput,
    provider: localStorage.getItem('yt_clipper_provider') || aiProvider,
  });

  // ── Auto Detect Viral Moments with AI
  const handleAutoDetect = async () => {
    setError('');
    if (!url) { setError('YouTube URL wajib diisi'); return; }
    if (!hasGroqKey && !hasOpenaiKey && !groqKeyInput && !openaiKeyInput) {
      setShowSettings(true);
      return;
    }

    setDetectingMoments(true);
    setProgressPercent(10);
    setProgressStage('Menghubungkan AI untuk analisis video...');
    setDetectedMoments([]);
    setGameBreaks([]);
    setVisibleMomentCount(20);

    try {
      const creds = readCredentials();
      await postSse('/api/auto-detect', {
        youtubeUrl: url,
        provider: creds.provider,
        groqApiKey: creds.groq,
        openaiApiKey: creds.openai,
        targetDuration,
        minDuration: customMinDuration,
        maxDuration: customMaxDuration,
        maxMoments,
        matchMode,
        detectGames: matchMode,
      }, (event) => {
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
        }
      });
    } catch (e: any) {
      if (e.needsConfig) setShowSettings(true);
      setError(e.message || 'Gagal mendeteksi momen viral');
    } finally {
      setDetectingMoments(false);
    }
  };

  // ── Single Clip Stream Generator Helper
  const processSingleClip = async (startSec: number, endSec: number, title?: string, segs?: any[]) => {
    const creds = readCredentials();

    await postSse('/api/clip', {
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
      provider: creds.provider,
      groqApiKey: creds.groq,
      openaiApiKey: creds.openai,
    }, (event) => {
      if (event.type === 'progress') {
        setProgressPercent(event.percent);
        setProgressStage(event.stage);
      } else if (event.type === 'done') {
        if (event.clip) downloadClip(event.clip);
      }
    });
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
      if (isBackendOfflineError(msg)) {
        setError(BACKEND_OFFLINE_MSG);
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
      if (isBackendOfflineError(msg)) {
        setError(BACKEND_OFFLINE_MSG);
      } else {
        setError(msg || 'Gagal melakukan batch generate');
      }
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
      if (isBackendOfflineError(msg)) {
        setError(BACKEND_OFFLINE_MSG);
      } else {
        setError(msg || 'Gagal memproses clip');
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

  return {
    createMode, setCreateMode,
    url, setUrl,
    framing, setFraming,
    facecamPos, setFacecamPos,
    quality, setQuality,
    burnCaptions, setBurnCaptions,
    captionPos, setCaptionPos,
    start, setStart, end, setEnd,
    detectingMoments, detectedMoments, setDetectedMoments,
    videoTitle, transcriptSegments,
    targetDuration, setTargetDuration,
    customMinDuration, setCustomMinDuration,
    customMaxDuration, setCustomMaxDuration,
    loading, progressPercent, progressStage, error, setError, success,
    matchMode, setMatchMode,
    gameBreaks, visibleMomentCount, setVisibleMomentCount,
    maxMoments, setMaxMoments,
    applyManualDurationPreset, nudgeManualEnd,
    updateMomentTime, updateMomentDuration,
    handleAutoDetect, processSingleClip, handleManualSubmit,
    handleBatchGenerate, handleGenerateSingleMoment, handleClipGameSegment,
  };
}

export type CreateApi = ReturnType<typeof useCreate>;
