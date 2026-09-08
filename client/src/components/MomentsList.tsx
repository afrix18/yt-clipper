import { formatSec } from '../lib/format';
import type { ViralMoment } from '../types';

interface MomentsListProps {
  moments: ViralMoment[];
  visibleCount: number;
  videoTitle: string;
  loading: boolean;
  onToggleSelect: (index: number) => void;
  onUpdateDuration: (index: number, deltaSec: number) => void;
  onUpdateTime: (index: number, newStart: number, newEnd: number) => void;
  onClipOne: (m: ViralMoment) => void;
  onBatchGenerate: () => void;
  onShowMore: () => void;
}

export function MomentsList({
  moments, visibleCount, videoTitle, loading,
  onToggleSelect, onUpdateDuration, onUpdateTime,
  onClipOne, onBatchGenerate, onShowMore,
}: MomentsListProps) {
  if (moments.length === 0) return null;

  return (
    <div className="viral-moments-section animate-in">
      <div className="viral-section-header">
        <div>
          <h4>🔥 {moments.length} Momen Viral Terdeteksi</h4>
          <p className="viral-video-title">{videoTitle}</p>
        </div>
        <button
          type="button"
          className="submit-btn batch-all-btn"
          onClick={onBatchGenerate}
          disabled={loading}
        >
          🚀 Generate Semua
        </button>
      </div>

      <div className="moments-list">
        {moments.slice(0, visibleCount).map((m, idx) => (
          <div key={idx} className="moment-card">
            <div className="moment-header">
              <input
                type="checkbox"
                checked={m.selected}
                onChange={() => onToggleSelect(idx)}
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
                  <button type="button" className="nudge-btn" onClick={() => onUpdateDuration(idx, -5)} title="Kurangi 5 detik">-5s</button>
                  <button type="button" className="nudge-btn" onClick={() => onUpdateDuration(idx, 5)} title="Tambah 5 detik">+5s</button>
                  <button type="button" className="nudge-btn" onClick={() => onUpdateDuration(idx, 15)} title="Tambah 15 detik">+15s</button>
                </div>
              </div>

              {/* Fine tuning Start & End */}
              <div className="moment-steppers-row">
                <div className="stepper-item">
                  <span className="stepper-label">Mulai:</span>
                  <div className="stepper-controls">
                    <button type="button" className="stepper-btn" onClick={() => onUpdateTime(idx, m.startSec - 5, m.endSec)}>-5s</button>
                    <button type="button" className="stepper-btn" onClick={() => onUpdateTime(idx, m.startSec - 1, m.endSec)}>-1s</button>
                    <span className="stepper-value">{formatSec(m.startSec)}</span>
                    <button type="button" className="stepper-btn" onClick={() => onUpdateTime(idx, m.startSec + 1, m.endSec)}>+1s</button>
                    <button type="button" className="stepper-btn" onClick={() => onUpdateTime(idx, m.startSec + 5, m.endSec)}>+5s</button>
                  </div>
                </div>
                <div className="stepper-item">
                  <span className="stepper-label">Selesai:</span>
                  <div className="stepper-controls">
                    <button type="button" className="stepper-btn" onClick={() => onUpdateTime(idx, m.startSec, m.endSec - 5)}>-5s</button>
                    <button type="button" className="stepper-btn" onClick={() => onUpdateTime(idx, m.startSec, m.endSec - 1)}>-1s</button>
                    <span className="stepper-value">{formatSec(m.endSec)}</span>
                    <button type="button" className="stepper-btn" onClick={() => onUpdateTime(idx, m.startSec, m.endSec + 1)}>+1s</button>
                    <button type="button" className="stepper-btn" onClick={() => onUpdateTime(idx, m.startSec, m.endSec + 5)}>+5s</button>
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
              onClick={() => onClipOne(m)}
              disabled={loading}
            >
              ✂️ Clip Momen Ini
            </button>
          </div>
        ))}
      </div>
      {moments.length > visibleCount && (
        <button
          type="button"
          className="ghost-btn moment-clip-btn"
          style={{ marginTop: '10px', width: '100%' }}
          onClick={onShowMore}
        >
          Tampilkan {Math.min(20, moments.length - visibleCount)} lagi ({visibleCount}/{moments.length})
        </button>
      )}
    </div>
  );
}
