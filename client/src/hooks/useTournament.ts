import { useState } from 'react';
import { BACKEND_OFFLINE_MSG, isBackendOfflineError } from '../lib/api';
import { startDetectJob, startClipJob, startBatchJob, waitForJob } from '../lib/jobs';
import { registerJob, unregisterJob } from '../lib/jobTracker';
import { parseTime, formatSec } from '../lib/format';
import { VIDEO_PRESET_UI } from '../lib/presets';
import type { ViralMoment, GameBreak, QualityMode, CaptionPosition, VideoPresetId } from '../types';

interface TournamentDeps {
  fetchClips: () => void | Promise<void>;
  downloadClip: (clip: any) => void;
  groqKeyInput: string;
  openaiKeyInput: string;
  aiProvider: string;
  hasGroqKey: boolean;
  hasOpenaiKey: boolean;
  setShowSettings: (v: boolean) => void;
}

export function useTournament(deps: TournamentDeps) {
  const { fetchClips, downloadClip, groqKeyInput, openaiKeyInput, aiProvider, hasGroqKey, hasOpenaiKey, setShowSettings } = deps;

  const [preset, setPresetState] = useState<VideoPresetId>('mlbb');
  const [url, setUrl] = useState('');
  const [quality, setQuality] = useState<QualityMode>('1080p');
  const [burnCaptions, setBurnCaptions] = useState(false);
  const [captionPos, setCaptionPos] = useState<CaptionPosition>('bottom');

  const [detectingMoments, setDetectingMoments] = useState(false);
  const [detectedMoments, setDetectedMoments] = useState<ViralMoment[]>([]);
  const [videoTitle, setVideoTitle] = useState('');
  const [transcriptSegments, setTranscriptSegments] = useState<any[]>([]);
  const [gameBreaks, setGameBreaks] = useState<GameBreak[]>([]);
  const [visibleMomentCount, setVisibleMomentCount] = useState(20);
  const [maxMoments, setMaxMoments] = useState(20);

  const [loading, setLoading] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressStage, setProgressStage] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const presetUi = VIDEO_PRESET_UI[preset];
  const framing = presetUi.framing;

  const setPreset = (p: VideoPresetId) => {
    setPresetState(p);
    const ui = VIDEO_PRESET_UI[p];
    setBurnCaptions(ui.burnCaptionsDefault);
    setCaptionPos(ui.captionPosDefault);
    setMaxMoments(ui.maxMomentsDefault);
  };

  const readCredentials = () => ({
    groq: localStorage.getItem('yt_clipper_groq_key') || groqKeyInput,
    openai: localStorage.getItem('yt_clipper_openai_key') || openaiKeyInput,
    provider: localStorage.getItem('yt_clipper_provider') || aiProvider,
  });

  const handleReset = () => {
    setUrl('');
    setDetectedMoments([]);
    setGameBreaks([]);
    setVideoTitle('');
    setTranscriptSegments([]);
    setError('');
    setSuccess(false);
    setProgressPercent(0);
    setProgressStage('');
  };

  const handleAutoDetect = async (forceRefresh = false) => {
    setError('');
    if (!url) { setError('YouTube URL wajib diisi'); return; }
    if (!hasGroqKey && !hasOpenaiKey && !groqKeyInput && !openaiKeyInput) {
      setShowSettings(true);
      return;
    }
    setDetectingMoments(true);
    setProgressPercent(1);
    setProgressStage('Mengantrekan analisis di server...');
    setDetectedMoments([]);
    setGameBreaks([]);
    setVisibleMomentCount(20);
    let jobId = '';
    try {
      const creds = readCredentials();
      jobId = await startDetectJob({
        youtubeUrl: url,
        provider: creds.provider,
        groqApiKey: creds.groq,
        openaiApiKey: creds.openai,
        preset,
        maxMoments,
        forceRefresh,
      });
      registerJob(jobId);
      const job = await waitForJob(jobId, (j) => {
        setProgressPercent(j.percent);
        setProgressStage(j.stage);
      });
      const r = job.result || {};
      setProgressPercent(100);
      setProgressStage('Analisis selesai!');
      setVideoTitle(r.videoTitle || '');
      setTranscriptSegments(r.transcriptSegments || []);
      setGameBreaks(r.gameBreaks || []);
      setDetectedMoments((r.moments || []).map((m: ViralMoment) => ({ ...m, selected: true })));
    } catch (e: any) {
      const msg = e.message || '';
      if ((e as any).needsConfig) setShowSettings(true);
      setError(isBackendOfflineError(msg) ? BACKEND_OFFLINE_MSG : (msg || 'Gagal mendeteksi momen'));
    } finally {
      if (jobId) unregisterJob(jobId);
      setDetectingMoments(false);
    }
  };

  const clipBody = (startSec: number, endSec: number, title?: string, segs?: any[]) => {
    const creds = readCredentials();
    return {
      youtubeUrl: url,
      startSec,
      endSec,
      framing,
      quality,
      burnCaptions,
      captionPos: burnCaptions ? captionPos : undefined,
      customTitle: title,
      transcriptSegments: segs || transcriptSegments,
      provider: creds.provider,
      groqApiKey: creds.groq,
      openaiApiKey: creds.openai,
    };
  };

  const processSingleClip = async (startSec: number, endSec: number, title?: string, segs?: any[]) => {
    const jobId = await startClipJob(clipBody(startSec, endSec, title, segs));
    registerJob(jobId);
    try {
      const job = await waitForJob(jobId, (j) => {
        setProgressPercent(j.percent);
        setProgressStage(j.stage);
      });
      if (job.result?.clip) downloadClip(job.result.clip);
    } finally {
      unregisterJob(jobId);
    }
  };

  const finishOk = (stage: string) => {
    setProgressPercent(100);
    setProgressStage(stage);
    setSuccess(true);
    fetchClips();
    setTimeout(() => setSuccess(false), 7000);
  };

  const failMsg = (e: any, fallback: string) => {
    const msg = (e as any)?.message || '';
    setError(isBackendOfflineError(msg) ? BACKEND_OFFLINE_MSG : (msg || fallback));
  };

  const handleBatchGenerate = async () => {
    const selected = detectedMoments.filter(m => m.selected);
    if (selected.length === 0) { setError('Pilih minimal 1 momen untuk di-render'); return; }
    setLoading(true);
    setError('');
    setSuccess(false);
    let batchId = '';
    try {
      const items = selected.map(m => clipBody(m.startSec, m.endSec, m.title, transcriptSegments));
      const started = await startBatchJob(items);
      batchId = started.batchId;
      registerJob(batchId);
      for (const id of started.jobIds) registerJob(id);
      await waitForJob(batchId, (j) => {
        setProgressPercent(j.percent);
        setProgressStage(j.stage);
      });
      for (const id of started.jobIds) unregisterJob(id);
      finishOk(`Semua ${selected.length} klip selesai di-render. Panel boleh ditutup kapan pun, antrean tetap jalan.`);
    } catch (e: any) {
      failMsg(e, 'Gagal batch generate');
    } finally {
      if (batchId) unregisterJob(batchId);
      setLoading(false);
    }
  };

  const handleGenerateSingleMoment = async (m: ViralMoment) => {
    setLoading(true);
    setError('');
    setSuccess(false);
    try {
      await processSingleClip(m.startSec, m.endSec, m.title, transcriptSegments);
      finishOk('Klip selesai!');
    } catch (e: any) {
      failMsg(e, 'Gagal memproses clip');
    } finally {
      setLoading(false);
    }
  };

  const handleClipGameSegment = async (gameIdx: number) => {
    if (gameBreaks.length === 0) return;
    const startSec = Math.max(0, gameBreaks[gameIdx].time);
    const nextBreak = gameBreaks[gameIdx + 1];
    const videoEnd = transcriptSegments.length > 0
      ? Math.max(...transcriptSegments.map((s: any) => Number(s.end) || 0))
      : startSec + 1800;
    const endSec = nextBreak ? nextBreak.time : Math.floor(videoEnd);
    if (endSec <= startSec) { setError('Segmen game tidak valid (batas akhir <= awal)'); return; }
    const gameTitle = `Game ${gameIdx + 1} - ${videoTitle || 'Match'}`;
    setLoading(true);
    setError('');
    setSuccess(false);
    try {
      setProgressStage(`Mengantrekan Game ${gameIdx + 1} (${formatSec(startSec)} - ${formatSec(endSec)})...`);
      await processSingleClip(startSec, endSec, gameTitle, transcriptSegments);
      finishOk(`Game ${gameIdx + 1} selesai dipotong!`);
    } catch (e: any) {
      failMsg(e, 'Gagal memotong segmen game');
    } finally {
      setLoading(false);
    }
  };

  const updateMomentTime = (index: number, newStart: number, newEnd: number) => {
    setDetectedMoments(prev => {
      const updated = [...prev];
      if (!updated[index]) return prev;
      const startClamped = Math.max(0, Math.round(newStart));
      const endClamped = Math.max(startClamped + 3, Math.round(newEnd));
      updated[index] = { ...updated[index], startSec: startClamped, endSec: endClamped, duration: endClamped - startClamped };
      return updated;
    });
  };

  const updateMomentDuration = (index: number, deltaSec: number) => {
    const m = detectedMoments[index];
    if (!m) return;
    updateMomentTime(index, m.startSec, Math.max(m.startSec + 3, m.endSec + deltaSec));
  };

  const toggleMomentSelect = (index: number) => {
    setDetectedMoments(prev => {
      const updated = [...prev];
      if (!updated[index]) return prev;
      updated[index] = { ...updated[index], selected: !updated[index].selected };
      return updated;
    });
  };

  const [manualStart, setManualStart] = useState('0:00');
  const [manualEnd, setManualEnd] = useState('5:00');
  const handleManualWar = async () => {
    setError('');
    setSuccess(false);
    if (!url) { setError('YouTube URL wajib diisi'); return; }
    const s = parseTime(manualStart);
    const e = parseTime(manualEnd);
    if (isNaN(s) || isNaN(e) || e <= s) { setError('Waktu start/end tidak valid'); return; }
    setLoading(true);
    setProgressPercent(1);
    setProgressStage('Mengantrekan potongan di server...');
    try {
      await processSingleClip(s, e, `${VIDEO_PRESET_UI[preset].label} - ${videoTitle || 'War'}`);
      finishOk('Klip selesai diproses!');
    } catch (err: any) {
      failMsg(err, 'Gagal memproses clip');
    } finally {
      setLoading(false);
    }
  };

  return {
    preset, setPreset, presetUi, framing,
    url, setUrl,
    quality, setQuality,
    burnCaptions, setBurnCaptions,
    captionPos, setCaptionPos,
    detectingMoments, detectedMoments, setDetectedMoments,
    videoTitle, transcriptSegments,
    gameBreaks, visibleMomentCount, setVisibleMomentCount,
    maxMoments, setMaxMoments,
    loading, progressPercent, progressStage, error, success,
    manualStart, setManualStart, manualEnd, setManualEnd,
    handleAutoDetect, handleBatchGenerate, handleGenerateSingleMoment,
    handleClipGameSegment, handleManualWar, handleReset,
    updateMomentTime, updateMomentDuration, toggleMomentSelect,
  };
}

export type TournamentApi = ReturnType<typeof useTournament>;
