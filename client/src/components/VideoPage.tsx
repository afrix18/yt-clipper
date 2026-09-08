import type { TournamentApi } from '../hooks/useTournament';
import type { SettingsApi } from '../hooks/useSettings';
import { VIDEO_PRESET_UI } from '../lib/presets';
import type { VideoPresetId } from '../types';

const PRESET_ORDER: VideoPresetId[] = ['streamer', 'mlbb', 'mlbb-vertical', 'podcast'];

interface VideoPageProps {
  studio: TournamentApi;
  settings: SettingsApi;
  onAnalyzed: () => void;
}

export function VideoPage({ studio: t, settings: s, onAnalyzed }: VideoPageProps) {
  const busy = t.detectingMoments || t.loading;
  const hasKey = s.hasGroqKey || s.hasOpenaiKey || !!s.groqKeyInput || !!s.openaiKeyInput;

  const handleAnalyze = async () => {
    await t.handleAutoDetect(false);
    onAnalyzed();
  };

  return (
    <div className="card animate-in">
      <div className="clip-form">
        <div className="input-group">
          <label>Jenis video</label>
          <div className="pill-group pill-group-grid">
            {PRESET_ORDER.map((id) => {
              const p = VIDEO_PRESET_UI[id];
              return (
                <button
                  key={id}
                  type="button"
                  className={`pill-btn ${t.preset === id ? 'active' : ''}`}
                  onClick={() => t.setPreset(id)}
                >
                  <div className="pill-text">
                    <span className="pill-title">{p.label}</span>
                    <span className="pill-desc">{p.desc}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="input-group">
          <label htmlFor="wizard-url">Link YouTube</label>
          <div className="input-wrapper">
            <input
              id="wizard-url"
              type="url"
              value={t.url}
              onChange={e => t.setUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
            />
          </div>
        </div>

        <button
          type="button"
          className="submit-btn ai-btn"
          style={{ width: '100%' }}
          onClick={handleAnalyze}
          disabled={busy}
        >
          {t.detectingMoments ? (
            <>Menganalisis ({t.progressPercent}%)</>
          ) : t.detectedMoments.length > 0 ? (
            <>Analisis Ulang</>
          ) : (
            <>Cari Momen</>
          )}
        </button>

        {busy && (
          <div className="progress-section">
            <div className="progress-header-row">
              <span className="progress-stage-text">{t.progressStage || 'Memproses...'}</span>
              <span className="progress-percent-number">{t.progressPercent}%</span>
            </div>
            <div className="progress-bar-track">
              <div className="progress-bar-fill-determinate" style={{ width: `${Math.min(100, Math.max(5, t.progressPercent))}%` }} />
            </div>
            <p className="input-hint">Panel boleh ditutup — analisis tetap berjalan di server.</p>
          </div>
        )}

        {t.error && <div className="error-msg"><span>{t.error}</span></div>}

        <div className="form-divider" />

        <details open={!hasKey}>
          <summary style={{ cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
            Kunci AI {hasKey ? '(terisi)' : '(wajib diisi sekali)'}
          </summary>
          <form onSubmit={s.saveSettings} style={{ marginTop: '10px' }}>
            <div className="input-group">
              <label>Penyedia AI</label>
              <div className="interval-pills">
                <button type="button" className={`interval-pill ${s.aiProvider === 'groq' ? 'active' : ''}`} onClick={() => s.setAiProvider('groq')}>Groq (gratis)</button>
                <button type="button" className={`interval-pill ${s.aiProvider === 'openai' ? 'active' : ''}`} onClick={() => s.setAiProvider('openai')}>OpenAI</button>
              </div>
            </div>
            {s.aiProvider === 'groq' ? (
              <div className="input-group">
                <label>Groq API Key</label>
                <div className="input-wrapper">
                  <input type="password" value={s.groqKeyInput} onChange={e => s.setGroqKeyInput(e.target.value)} placeholder="gsk_..." />
                </div>
                <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="api-link">
                  Ambil Groq API Key gratis di console.groq.com
                </a>
              </div>
            ) : (
              <div className="input-group">
                <label>OpenAI API Key</label>
                <div className="input-wrapper">
                  <input type="password" value={s.openaiKeyInput} onChange={e => s.setOpenaiKeyInput(e.target.value)} placeholder="sk-..." />
                </div>
              </div>
            )}
            {s.settingsMsg && <p className="settings-feedback">{s.settingsMsg}</p>}
            <button type="submit" className="submit-btn" style={{ width: '100%' }}>Simpan Kunci</button>
          </form>
        </details>
      </div>
    </div>
  );
}
