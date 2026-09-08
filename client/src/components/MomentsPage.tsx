import { parseTime, formatSec } from '../lib/format';
import type { TournamentApi } from '../hooks/useTournament';
import { MomentsList } from './MomentsList';
import { GameBreaksList } from './GameBreaksList';

interface MomentsPageProps {
  studio: TournamentApi;
  onRendered: () => void;
  onGoVideo: () => void;
}

export function MomentsPage({ studio: t, onRendered, onGoVideo }: MomentsPageProps) {
  const videoEndSec = t.transcriptSegments.length > 0
    ? Math.max(...t.transcriptSegments.map((s: any) => Number(s.end) || 0))
    : 0;
  const isMlbb = t.preset === 'mlbb' || t.preset === 'mlbb-vertical';
  const busy = t.detectingMoments || t.loading;
  const selectedCount = t.detectedMoments.filter(m => m.selected).length;

  const manualSecs = (() => {
    const s = parseTime(t.manualStart);
    const e = parseTime(t.manualEnd);
    return !isNaN(s) && !isNaN(e) && e > s ? Math.round(e - s) : 0;
  })();

  if (!busy && t.detectedMoments.length === 0 && !t.error) {
    return (
      <div className="card animate-in">
        <div className="empty-state">
          <h3>Belum ada hasil analisis</h3>
          <p>Mulai dari langkah Video untuk mencari momen.</p>
          <button className="ghost-btn" onClick={onGoVideo}>Ke Langkah Video</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card animate-in">
      <div className="clip-form">
        {t.videoTitle && (
          <div className="input-group">
            <label>Hasil analisis</label>
            <p className="viral-video-title">{t.videoTitle} — {t.detectedMoments.length} momen</p>
          </div>
        )}

        {busy && (
          <div className="progress-section">
            <div className="progress-header-row">
              <span className="progress-stage-text">{t.progressStage || 'Memproses...'}</span>
              <span className="progress-percent-number">{t.progressPercent}%</span>
            </div>
            <div className="progress-bar-track">
              <div className="progress-bar-fill-determinate" style={{ width: `${Math.min(100, Math.max(5, t.progressPercent))}%` }} />
            </div>
            <p className="input-hint">Panel boleh ditutup — tugas tetap berjalan di server.</p>
          </div>
        )}

        {t.error && <div className="error-msg"><span>{t.error}</span></div>}
        {t.success && <div className="success-msg"><span>{t.progressStage || 'Berhasil!'}</span></div>}

        {t.detectedMoments.length > 0 && (
          <>
            <button
              type="button"
              className="submit-btn ai-btn"
              style={{ width: '100%' }}
              onClick={async () => { await t.handleBatchGenerate(); onRendered(); }}
              disabled={t.loading}
            >
              {t.loading ? 'Merender...' : `Render yang dipilih (${selectedCount})`}
            </button>

            {isMlbb && (
              <GameBreaksList
                breaks={t.gameBreaks}
                framing={t.framing}
                videoEndSec={videoEndSec}
                loading={t.loading}
                onClipGame={t.handleClipGameSegment}
              />
            )}
            <MomentsList
              moments={t.detectedMoments}
              visibleCount={t.visibleMomentCount}
              videoTitle=""
              loading={t.loading}
              onToggleSelect={t.toggleMomentSelect}
              onUpdateDuration={t.updateMomentDuration}
              onUpdateTime={t.updateMomentTime}
              onClipOne={t.handleGenerateSingleMoment}
              onBatchGenerate={t.handleBatchGenerate}
              onShowMore={() => t.setVisibleMomentCount(v => v + 20)}
              onReset={() => { t.handleReset(); onGoVideo(); }}
            />

            <div className="form-divider" />

            <details>
              <summary style={{ cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                Potong manual (tulis jam sendiri)
              </summary>
              <div style={{ marginTop: '10px' }}>
                <div className="time-row">
                  <div className="time-input-col">
                    <span className="time-sublabel">Mulai:</span>
                    <div className="input-wrapper">
                      <input type="text" value={t.manualStart} onChange={e => t.setManualStart(e.target.value)} placeholder="0:00" />
                    </div>
                  </div>
                  <div className="time-input-col">
                    <span className="time-sublabel">Selesai:</span>
                    <div className="input-wrapper">
                      <input type="text" value={t.manualEnd} onChange={e => t.setManualEnd(e.target.value)} placeholder="5:00" />
                    </div>
                  </div>
                </div>
                <button type="button" className="ghost-btn" style={{ width: '100%', marginTop: '8px' }} onClick={t.handleManualWar} disabled={t.loading}>
                  Potong Manual {manualSecs > 0 && `(${formatSec(manualSecs)})`}
                </button>
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
