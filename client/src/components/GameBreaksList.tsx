import { formatSec } from '../lib/format';
import type { GameBreak } from '../types';

interface GameBreaksListProps {
  breaks: GameBreak[];
  framing: string;
  videoEndSec: number;
  loading: boolean;
  onClipGame: (gameIdx: number) => void;
}

export function GameBreaksList({ breaks, framing, videoEndSec, loading, onClipGame }: GameBreaksListProps) {
  if (breaks.length === 0) return null;

  return (
    <div className="game-breaks-section animate-in" style={{ marginBottom: '14px' }}>
      <h4>🏟️ {breaks.length} Batas Game Terdeteksi</h4>
      <p className="viral-video-title">Potong per game (format mengikuti framing aktif: {framing === 'landscape' ? '16:9' : '9:16'})</p>
      <div className="moments-list">
        {breaks.map((g, idx) => {
          const nextBreak = breaks[idx + 1];
          const segEnd = nextBreak ? nextBreak.time : Math.floor(videoEndSec);
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
                onClick={() => onClipGame(idx)}
                disabled={loading}
              >
                ✂️ Potong Game {idx + 1}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
