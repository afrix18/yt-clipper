import { parseTime, formatSec } from '../lib/format';
import type { CreateApi } from '../hooks/useCreate';
import { MomentsList } from './MomentsList';
import { GameBreaksList } from './GameBreaksList';

interface CreatePanelProps {
  create: CreateApi;
  onToggleMomentSelect: (index: number) => void;
}

export function CreatePanel({ create, onToggleMomentSelect }: CreatePanelProps) {
  const c = create;
  const videoEndSec = c.transcriptSegments.length > 0
    ? Math.max(...c.transcriptSegments.map((s: any) => Number(s.end) || 0))
    : 0;

  return (
    <div className="card animate-in">
      {/* Mode Switcher: Auto AI vs Manual */}
      <div className="mode-switcher">
        <button
          className={`mode-btn ${c.createMode === 'auto' ? 'active' : ''}`}
          onClick={() => c.setCreateMode('auto')}
        >
          ⚡ Auto AI Viral Clips
        </button>
        <button
          className={`mode-btn ${c.createMode === 'manual' ? 'active' : ''}`}
          onClick={() => c.setCreateMode('manual')}
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
              value={c.url}
              onChange={e => c.setUrl(e.target.value)}
              required
              placeholder="https://youtube.com/watch?v=..."
            />
          </div>
        </div>

        {/* Manual Mode Time Row */}
        {c.createMode === 'manual' && (
          <div className="input-group">
            <div className="label-with-duration">
              <label>Waktu Clip <span className="input-hint">— format mm:ss atau detik</span></label>
              {(() => {
                const s = parseTime(c.start);
                const e = parseTime(c.end);
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
                  <input type="text" value={c.start} onChange={e => c.setStart(e.target.value)} required placeholder="0:00" />
                </div>
              </div>
              <div className="time-input-col">
                <span className="time-sublabel">⏹️ Selesai:</span>
                <div className="input-wrapper">
                  <span className="input-icon">🏁</span>
                  <input type="text" value={c.end} onChange={e => c.setEnd(e.target.value)} required placeholder="0:45" />
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
                    onClick={() => c.applyManualDurationPreset(s)}
                    title={`Set durasi persis ${s} detik`}
                  >
                    {s}s
                  </button>
                ))}
              </div>
              <div className="preset-nudge-group">
                <button type="button" className="preset-nudge-btn" onClick={() => c.nudgeManualEnd(-5)} title="Kurangi 5 detik">-5s</button>
                <button type="button" className="preset-nudge-btn" onClick={() => c.nudgeManualEnd(5)} title="Tambah 5 detik">+5s</button>
                <button type="button" className="preset-nudge-btn" onClick={() => c.nudgeManualEnd(15)} title="Tambah 15 detik">+15s</button>
              </div>
            </div>
          </div>
        )}

        {/* Auto AI Mode Duration Preference */}
        {c.createMode === 'auto' && (
          <div className="input-group">
            <label>Target Durasi Klip AI <span className="input-hint">— fleksibel & tidak harus 30 detik</span></label>
            <div className="pill-group pill-group-grid duration-pills">
              <button
                type="button"
                className={`pill-btn ${c.targetDuration === 'auto' ? 'active' : ''}`}
                onClick={() => c.setTargetDuration('auto')}
              >
                <span className="pill-icon">🔄</span>
                <div className="pill-text">
                  <span className="pill-title">Bebas / Alami (15s–90s)</span>
                  <span className="pill-desc">AI potong utuh sesuai konteks cerita</span>
                </div>
              </button>
              <button
                type="button"
                className={`pill-btn ${c.targetDuration === 'short' ? 'active' : ''}`}
                onClick={() => c.setTargetDuration('short')}
              >
                <span className="pill-icon">⚡</span>
                <div className="pill-text">
                  <span className="pill-title">Pendek (15s–30s)</span>
                  <span className="pill-desc">Hook kilat & punchline cepat</span>
                </div>
              </button>
              <button
                type="button"
                className={`pill-btn ${c.targetDuration === 'medium' ? 'active' : ''}`}
                onClick={() => c.setTargetDuration('medium')}
              >
                <span className="pill-icon">⏱️</span>
                <div className="pill-text">
                  <span className="pill-title">Standar (30s–60s)</span>
                  <span className="pill-desc">Optimal YouTube Shorts & TikTok</span>
                </div>
              </button>
              <button
                type="button"
                className={`pill-btn ${c.targetDuration === 'long' ? 'active' : ''}`}
                onClick={() => c.setTargetDuration('long')}
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
                className={`custom-toggle-btn ${c.targetDuration === 'custom' ? 'active' : ''}`}
                onClick={() => c.setTargetDuration(c.targetDuration === 'custom' ? 'auto' : 'custom')}
              >
                <span>⚙️</span> {c.targetDuration === 'custom' ? 'Tutup Custom Rentang' : 'Atur Rentang Detik Sendiri (Custom)'}
              </button>
            </div>

            {c.targetDuration === 'custom' && (
              <div className="custom-duration-box animate-in">
                <div className="custom-duration-inputs">
                  <div className="custom-input-col">
                    <span className="custom-dur-label">Min Detik:</span>
                    <input
                      type="number"
                      value={c.customMinDuration}
                      onChange={e => c.setCustomMinDuration(Math.max(5, parseInt(e.target.value) || 10))}
                      min={5}
                      max={c.customMaxDuration - 1}
                      className="custom-dur-input"
                    />
                  </div>
                  <span className="custom-dur-separator">sampai</span>
                  <div className="custom-input-col">
                    <span className="custom-dur-label">Max Detik:</span>
                    <input
                      type="number"
                      value={c.customMaxDuration}
                      onChange={e => c.setCustomMaxDuration(Math.max(c.customMinDuration + 5, parseInt(e.target.value) || 60))}
                      min={c.customMinDuration + 1}
                      max={2700}
                      className="custom-dur-input"
                    />
                  </div>
                </div>
                <p className="custom-dur-hint">AI akan mencari momen viral dengan durasi antara {c.customMinDuration}s sampai {c.customMaxDuration}s. Untuk potongan game panjang (s/d 45 menit), isi max hingga 2700.</p>
              </div>
            )}
          </div>
        )}

        {/* Jumlah Momen AI */}
        {c.createMode === 'auto' && (
          <div className="input-group">
            <label>Jumlah Momen Viral <span className="input-hint">— maks hasil analisis AI</span></label>
            <div className="interval-pills">
              {[5, 10, 15, 20, 30, 50].map(n => (
                <button
                  key={n}
                  type="button"
                  className={`interval-pill ${c.maxMoments === n ? 'active' : ''}`}
                  onClick={() => c.setMaxMoments(n)}
                >
                  {n} momen
                </button>
              ))}
            </div>
            <label className="matchmode-toggle" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={c.matchMode}
                onChange={() => {
                  const next = !c.matchMode;
                  c.setMatchMode(next);
                  if (next && c.maxMoments < 20) c.setMaxMoments(20);
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
              className={`pill-btn ${c.framing === 'smart' ? 'active' : ''}`}
              onClick={() => c.setFraming('smart')}
            >
              <span className="pill-icon">🤖</span>
              <div className="pill-text">
                <span className="pill-title">Smart Auto-Crop</span>
                <span className="pill-desc">Fokus otomatis ke wajah</span>
              </div>
            </button>
            <button
              type="button"
              className={`pill-btn ${c.framing === 'streamer' ? 'active' : ''}`}
              onClick={() => c.setFraming('streamer')}
            >
              <span className="pill-icon">🎮</span>
              <div className="pill-text">
                <span className="pill-title">Mode Streamer</span>
                <span className="pill-desc">Split: Facecam + Game</span>
              </div>
            </button>
            <button
              type="button"
              className={`pill-btn ${c.framing === 'blur' ? 'active' : ''}`}
              onClick={() => c.setFraming('blur')}
            >
              <span className="pill-icon">🌫️</span>
              <div className="pill-text">
                <span className="pill-title">Blur Background</span>
                <span className="pill-desc">Video utuh + latar blur</span>
              </div>
            </button>
            <button
              type="button"
              className={`pill-btn ${c.framing === 'crop' ? 'active' : ''}`}
              onClick={() => c.setFraming('crop')}
            >
              <span className="pill-icon">✂️</span>
              <div className="pill-text">
                <span className="pill-title">Crop Tengah</span>
                <span className="pill-desc">Potong 9:16 tepat di tengah</span>
              </div>
            </button>
            <button
              type="button"
              className={`pill-btn ${c.framing === 'landscape' ? 'active' : ''}`}
              onClick={() => c.setFraming('landscape')}
            >
              <span className="pill-icon">📐</span>
              <div className="pill-text">
                <span className="pill-title">Landscape 16:9</span>
                <span className="pill-desc">Potongan game / video reguler</span>
              </div>
            </button>
          </div>

          {/* Streamer Facecam Position Selector */}
          {c.framing === 'streamer' && (
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
                  className={`corner-btn ${c.facecamPos === 'auto' ? 'active' : ''}`}
                  onClick={() => c.setFacecamPos('auto')}
                >
                  <span>🎯</span> Auto (Deteksi AI)
                </button>
                <button
                  type="button"
                  className={`corner-btn ${c.facecamPos === 'bottom-right' ? 'active' : ''}`}
                  onClick={() => c.setFacecamPos('bottom-right')}
                >
                  <span>↘️</span> Kanan Bawah
                </button>
                <button
                  type="button"
                  className={`corner-btn ${c.facecamPos === 'bottom-left' ? 'active' : ''}`}
                  onClick={() => c.setFacecamPos('bottom-left')}
                >
                  <span>↙️</span> Kiri Bawah
                </button>
                <button
                  type="button"
                  className={`corner-btn ${c.facecamPos === 'top-right' ? 'active' : ''}`}
                  onClick={() => c.setFacecamPos('top-right')}
                >
                  <span>↗️</span> Kanan Atas
                </button>
                <button
                  type="button"
                  className={`corner-btn ${c.facecamPos === 'top-left' ? 'active' : ''}`}
                  onClick={() => c.setFacecamPos('top-left')}
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
              className={`pill-btn ${c.quality === '1080p' ? 'active' : ''}`}
              onClick={() => c.setQuality('1080p')}
            >
              <span className="pill-icon">💎</span>
              <div className="pill-text">
                <span className="pill-title">1080p Full HD</span>
                <span className="pill-desc">Kualitas terbaik</span>
              </div>
            </button>
            <button
              type="button"
              className={`pill-btn ${c.quality === '720p' ? 'active' : ''}`}
              onClick={() => c.setQuality('720p')}
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
            className={`toggle-switch ${c.burnCaptions ? 'on' : ''}`}
            onClick={() => c.setBurnCaptions(!c.burnCaptions)}
          >
            <span className="toggle-knob" />
          </button>
        </div>

        {/* Caption Vertical Position Selector */}
        {c.burnCaptions && (
          <div className="caption-pos-group animate-in">
            <div className="label-row">
              <label>Posisi Teks Transcript</label>
              <span className="input-hint">— dipindahkan ke atas agar tidak menutupi orang</span>
            </div>
            <div className="caption-pos-options">
              <button
                type="button"
                className={`pos-btn ${c.captionPos === 'middle' ? 'active' : ''}`}
                onClick={() => c.setCaptionPos('middle')}
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
                className={`pos-btn ${c.captionPos === 'top' ? 'active' : ''}`}
                onClick={() => c.setCaptionPos('top')}
              >
                <span className="pos-btn-icon">⬆️</span>
                <div className="pos-btn-text">
                  <span className="pos-btn-title">Atas</span>
                  <span className="pos-btn-desc">Di sepertiga atas layar video</span>
                </div>
              </button>

              <button
                type="button"
                className={`pos-btn ${c.captionPos === 'bottom' ? 'active' : ''}`}
                onClick={() => c.setCaptionPos('bottom')}
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
        {c.createMode === 'auto' ? (
          <button
            type="button"
            className="submit-btn ai-btn"
            onClick={c.handleAutoDetect}
            disabled={c.detectingMoments || c.loading}
          >
            {c.detectingMoments ? (
              <>
                <span className="spinner" />
                AI Menganalisis Video ({c.progressPercent}%)
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
            onClick={c.handleManualSubmit}
            disabled={c.loading}
          >
            {c.loading ? (
              <>
                <span className="spinner" />
                Memproses ({c.progressPercent}%)
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
        {(c.loading || c.detectingMoments) && (
          <div className="progress-section">
            <div className="progress-header-row">
              <span className="progress-stage-text">{c.progressStage || 'Memproses...'}</span>
              <span className="progress-percent-number">{c.progressPercent}%</span>
            </div>
            <div className="progress-bar-track">
              <div className="progress-bar-fill-determinate" style={{ width: `${Math.min(100, Math.max(5, c.progressPercent))}%` }} />
            </div>
          </div>
        )}

        {c.error && <div className="error-msg"><span className="error-icon">⚠️</span><span>{c.error}</span></div>}
        {c.success && <div className="success-msg"><span>✅</span><span>{c.progressStage || 'Berhasil! File diunduh & tersimpan di Histori.'}</span></div>}

        {/* ═══ Detected Viral Moments List (Auto AI Mode) ═══ */}
        {c.createMode === 'auto' && c.detectedMoments.length > 0 && (
          <>
            <GameBreaksList
              breaks={c.gameBreaks}
              framing={c.framing}
              videoEndSec={videoEndSec}
              loading={c.loading}
              onClipGame={c.handleClipGameSegment}
            />
            <MomentsList
              moments={c.detectedMoments}
              visibleCount={c.visibleMomentCount}
              videoTitle={c.videoTitle}
              loading={c.loading}
              onToggleSelect={onToggleMomentSelect}
              onUpdateDuration={c.updateMomentDuration}
              onUpdateTime={c.updateMomentTime}
              onClipOne={c.handleGenerateSingleMoment}
              onBatchGenerate={c.handleBatchGenerate}
              onShowMore={() => c.setVisibleMomentCount(v => v + 20)}
            />
          </>
        )}
      </div>
    </div>
  );
}
