import { useEffect, useMemo, useState } from 'react';
import { API } from '../lib/api';
import { formatDate } from '../lib/format';
import type { ClipMeta } from '../types';

declare const chrome: any;

type SortKey = 'newest' | 'oldest' | 'longest' | 'shortest';
type FramingFilter = 'all' | 'mlbb' | 'mlbb-vertical' | 'streamer' | 'other';

const LIBRARY_SELECTION_KEY = 'yt_clipper_library_selection';

function framingLabel(framing?: string): string {
  switch (framing) {
    case 'streamer': return 'Streamer 9:16';
    case 'mlbb': return 'MLBB 4:3';
    case 'mlbb-vertical': return 'MLBB Vertikal';
    case 'smart': return 'Smart Crop';
    case 'landscape': return 'Landscape 16:9';
    case 'blur': return 'Blur BG';
    default: return 'Crop Tengah';
  }
}

function framingGroup(framing?: string): Exclude<FramingFilter, 'all'> {
  if (framing === 'mlbb' || framing === 'mlbb-vertical' || framing === 'streamer') return framing;
  return 'other';
}

export function LibraryApp() {
  const [clips, setClips] = useState<ClipMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [framing, setFraming] = useState<FramingFilter>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState('');

  const fetchClips = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/clips`);
      setClips(await r.json());
    } catch {
      setNotice('Tidak bisa menghubungi server lokal (port 3002). Pastikan server berjalan.');
    }
    setLoading(false);
  };

  useEffect(() => { fetchClips(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = clips.filter(c => {
      if (framing !== 'all' && framingGroup(c.framing) !== framing) return false;
      if (q && !(c.title || '').toLowerCase().includes(q)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === 'oldest') return a.createdAt.localeCompare(b.createdAt);
      if (sort === 'longest') return b.duration - a.duration;
      if (sort === 'shortest') return a.duration - b.duration;
      return b.createdAt.localeCompare(a.createdAt);
    });
    return list;
  }, [clips, query, framing, sort]);

  const preview = previewId ? clips.find(c => c.id === previewId) || null : null;

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteClip = async (id: string) => {
    if (!confirm('Hapus klip ini?')) return;
    await fetch(`${API}/api/clips/${id}`, { method: 'DELETE' });
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    fetchClips();
  };

  const downloadClip = (clip: ClipMeta) => {
    const a = document.createElement('a');
    a.href = `${API}/api/clips/${clip.id}`;
    a.download = clip.filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch { /* ignore */ } }, 150);
  };

  const sendToPublish = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ [LIBRARY_SELECTION_KEY]: ids });
      } else {
        localStorage.setItem(LIBRARY_SELECTION_KEY, JSON.stringify(ids));
      }
      setNotice(`${ids.length} klip dikirim ke langkah Publikasi di side panel. Tutup tab ini dan buka Publikasi.`);
    } catch {
      setNotice('Gagal menyimpan pilihan.');
    }
  };

  return (
    <div className="library">
      <header className="library-header">
        <div>
          <h1>Library Klip</h1>
          <p>{clips.length} klip di server lokal</p>
        </div>
        <button type="button" className="lib-btn" onClick={fetchClips}>Muat Ulang</button>
      </header>

      <div className="library-toolbar">
        <input
          type="search"
          className="lib-search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Cari judul klip..."
        />
        <div className="lib-filters">
          {([['all', 'Semua'], ['mlbb', 'MLBB 4:3'], ['mlbb-vertical', 'MLBB Vertikal'], ['streamer', 'Streamer'], ['other', 'Lainnya']] as [FramingFilter, string][]).map(([v, label]) => (
            <button key={v} type="button" className={`lib-pill ${framing === v ? 'active' : ''}`} onClick={() => setFraming(v)}>
              {label}
            </button>
          ))}
        </div>
        <select className="lib-select" value={sort} onChange={e => setSort(e.target.value as SortKey)}>
          <option value="newest">Terbaru</option>
          <option value="oldest">Terlama</option>
          <option value="longest">Terpanjang</option>
          <option value="shortest">Terpendek</option>
        </select>
      </div>

      {selected.size > 0 && (
        <div className="library-selection-bar">
          <span>{selected.size} dipilih</span>
          <button type="button" className="lib-btn primary" onClick={sendToPublish}>Kirim ke Publikasi</button>
          <button type="button" className="lib-btn" onClick={() => setSelected(new Set())}>Batal</button>
        </div>
      )}

      {notice && <p className="library-notice">{notice}</p>}
      {loading && <p className="library-notice">Memuat...</p>}

      {!loading && filtered.length === 0 && (
        <div className="library-empty">
          <h3>Tidak ada klip yang cocok</h3>
          <p>Ubah kata kunci atau filter format.</p>
        </div>
      )}

      <div className="library-grid">
        {filtered.map(clip => (
          <article key={clip.id} className={`lib-card ${selected.has(clip.id) ? 'selected' : ''}`}>
            <label className="lib-check">
              <input type="checkbox" checked={selected.has(clip.id)} onChange={() => toggleSelect(clip.id)} />
            </label>
            <button type="button" className="lib-thumb" onClick={() => setPreviewId(clip.id)} title="Putar pratinjau">
              <video src={`${API}/clips/${clip.filename}`} preload="metadata" muted playsInline />
              <span className="lib-duration">{clip.durationFormatted}</span>
            </button>
            <div className="lib-meta">
              <h3 title={clip.title}>{clip.title}</h3>
              <p>{framingLabel(clip.framing)} · {clip.quality || '1080p'} · {clip.fileSizeMB} MB</p>
              <p className="lib-date">{formatDate(clip.createdAt)}{clip.virality ? ` · Skor ${clip.virality.total}/100` : ''}</p>
              <div className="lib-actions">
                <button type="button" onClick={() => setPreviewId(clip.id)}>Putar</button>
                <button type="button" onClick={() => downloadClip(clip)}>Unduh</button>
                <button type="button" className="danger" onClick={() => deleteClip(clip.id)}>Hapus</button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {preview && (
        <div className="lib-modal" onClick={() => setPreviewId(null)}>
          <div className="lib-modal-box" onClick={e => e.stopPropagation()}>
            <div className="lib-modal-head">
              <h3>{preview.title}</h3>
              <button type="button" onClick={() => setPreviewId(null)}>Tutup</button>
            </div>
            <video src={`${API}/clips/${preview.filename}`} controls autoPlay playsInline className="lib-player" />
            <p className="lib-modal-meta">
              {framingLabel(preview.framing)} · {preview.resolution || ''} · {preview.fileSizeMB} MB
            </p>
            {preview.transcript && <p className="lib-transcript">{preview.transcript.slice(0, 600)}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
