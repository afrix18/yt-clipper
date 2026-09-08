import { API } from '../lib/api';
import { formatDate } from '../lib/format';
import type { ClipsApi } from '../hooks/useClips';
import type { ClipMeta } from '../types';

interface HistoryPanelProps {
  clips: ClipsApi;
  onUploadClip: (clip: ClipMeta) => void;
  onGoVideo: () => void;
}

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

export function HistoryPanel({ clips, onUploadClip, onGoVideo }: HistoryPanelProps) {
  const {
    clips: clipList, loadingClips,
    previewClipId, setPreviewClipId,
    transcriptClipId, setTranscriptClipId,
    transcript, loadingTranscript, loadingVirality,
    deleteClip, downloadClip, analyzeVirality, transcribeClip,
  } = clips;

  const ViralityBadge = ({ virality }: { virality: ClipMeta['virality'] }) => {
    if (!virality) return null;
    const cls = `virality-badge virality-${virality.grade}`;
    return <span className={cls}>{virality.total}/100</span>;
  };

  return (
    <div className="history-panel animate-in">
      {loadingClips && <div className="loading-placeholder"><span className="spinner" /> Memuat daftar klip...</div>}

      {!loadingClips && clipList.length === 0 && (
        <div className="empty-state">
          <h3>Belum ada klip</h3>
          <p>Buat klip pertama untuk memulai.</p>
          <button className="ghost-btn" onClick={onGoVideo}>Buat Klip Pertama</button>
        </div>
      )}

      {clipList.map(clip => (
        <div key={clip.id} className="clip-card">
          <div className="clip-card-header">
            <div className="clip-title-row">
              <h3 className="clip-title">{clip.title}</h3>
              {clip.virality && <ViralityBadge virality={clip.virality} />}
            </div>
            <div className="clip-tags-row">
              <span className="clip-tag">{clip.durationFormatted}</span>
              <span className="clip-tag">{clip.fileSizeMB} MB</span>
              <span className="clip-tag">{framingLabel(clip.framing)}</span>
              <span className="clip-tag">{clip.quality || '1080p'}</span>
              {clip.hasCaptions && <span className="clip-tag caption-tag">Subtitle</span>}
              <span className="clip-tag">{formatDate(clip.createdAt)}</span>
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
                Tutup Player
              </button>
            </div>
          ) : (
            <div className="preview-trigger-box" onClick={() => setPreviewClipId(clip.id)}>
              <span className="play-icon-badge">▶</span>
              <span>Putar Pratinjau</span>
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
                <p key={i} className="virality-tip">{tip}</p>
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
                  <button className="ghost-btn ghost-btn-sm" onClick={() => navigator.clipboard.writeText(transcript)}>Salin Teks</button>
                </>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="clip-actions">
            <button className="action-btn" onClick={() => downloadClip(clip)} title="Unduh file"><span className="action-label">Unduh</span></button>
            <button className="action-btn" onClick={() => analyzeVirality(clip)} disabled={loadingVirality === clip.id} title="Skor viralitas">
              {loadingVirality === clip.id ? <span className="spinner-sm" /> : null}
              <span className="action-label">Skor</span>
            </button>
            <button className="action-btn" onClick={() => { if (transcriptClipId === clip.id) setTranscriptClipId(null); else transcribeClip(clip); }} title="Transkripsi">
              {loadingTranscript && transcriptClipId === clip.id ? <span className="spinner-sm" /> : null}
              <span className="action-label">Transkrip</span>
            </button>
            <button className="action-btn" onClick={() => onUploadClip(clip)} title="Lanjut ke publikasi"><span className="action-label">Publikasikan</span></button>
            <button className="action-btn action-btn-danger" onClick={() => deleteClip(clip.id)} title="Hapus"><span className="action-label">Hapus</span></button>
          </div>
        </div>
      ))}
    </div>
  );
}
