import { useState, useEffect, useCallback } from 'react';
import { API } from '../lib/api';
import type { ClipMeta } from '../types';

declare const chrome: any;

export function useClips(fetchOnMount = true) {
  const [clips, setClips] = useState<ClipMeta[]>([]);
  const [loadingClips, setLoadingClips] = useState(false);
  const [previewClipId, setPreviewClipId] = useState<string | null>(null);
  const [transcriptClipId, setTranscriptClipId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [loadingVirality, setLoadingVirality] = useState<string | null>(null);

  const fetchClips = useCallback(async () => {
    setLoadingClips(true);
    try {
      const r = await fetch(`${API}/api/clips`);
      const data = await r.json();
      setClips(data);
    } catch { /* ignore */ }
    setLoadingClips(false);
  }, []);

  useEffect(() => {
    if (fetchOnMount) fetchClips();
  }, [fetchClips, fetchOnMount]);

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
      try { document.body.removeChild(a); } catch { /* ignore */ }
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

  return {
    clips, loadingClips,
    previewClipId, setPreviewClipId,
    transcriptClipId, setTranscriptClipId,
    transcript, loadingTranscript, loadingVirality,
    fetchClips, deleteClip, downloadClip, analyzeVirality, transcribeClip,
  };
}

export type ClipsApi = ReturnType<typeof useClips>;
