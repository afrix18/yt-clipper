import type { SettingsApi } from '../hooks/useSettings';

export function SettingsModal({ settings }: { settings: SettingsApi }) {
  const {
    showSettings, setShowSettings,
    aiProvider, setAiProvider,
    groqKeyInput, setGroqKeyInput,
    openaiKeyInput, setOpenaiKeyInput,
    settingsMsg,
    saveSettings,
  } = settings;

  if (!showSettings) return null;

  return (
    <div className="card settings-card animate-in">
      <div className="section-header">
        <h3>⚙️ Pengaturan AI Key</h3>
        <p className="section-desc">Gunakan Groq API (Gratis & Cepat 1-2 detik) atau OpenAI untuk transkripsi dan deteksi momen viral.</p>
      </div>
      <form onSubmit={saveSettings} className="settings-form">
        <div className="input-group">
          <label>AI Provider</label>
          <div className="pill-group">
            <button
              type="button"
              className={`pill-btn ${aiProvider === 'groq' ? 'active' : ''}`}
              onClick={() => setAiProvider('groq')}
            >
              <span className="pill-icon">⚡</span>
              <div className="pill-text">
                <span className="pill-title">Groq (Gratis)</span>
                <span className="pill-desc">Super cepat & akurat</span>
              </div>
            </button>
            <button
              type="button"
              className={`pill-btn ${aiProvider === 'openai' ? 'active' : ''}`}
              onClick={() => setAiProvider('openai')}
            >
              <span className="pill-icon">🤖</span>
              <div className="pill-text">
                <span className="pill-title">OpenAI</span>
                <span className="pill-desc">Whisper + GPT-4o</span>
              </div>
            </button>
          </div>
        </div>

        {aiProvider === 'groq' && (
          <div className="input-group">
            <label>Groq API Key</label>
            <div className="input-wrapper">
              <span className="input-icon">🔑</span>
              <input
                type="password"
                value={groqKeyInput}
                onChange={e => setGroqKeyInput(e.target.value)}
                placeholder="gsk_..."
              />
            </div>
            <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="api-link">
              🔗 Ambil Groq API Key Gratis di console.groq.com →
            </a>
          </div>
        )}

        {aiProvider === 'openai' && (
          <div className="input-group">
            <label>OpenAI API Key</label>
            <div className="input-wrapper">
              <span className="input-icon">🔑</span>
              <input
                type="password"
                value={openaiKeyInput}
                onChange={e => setOpenaiKeyInput(e.target.value)}
                placeholder="sk-..."
              />
            </div>
          </div>
        )}

        {settingsMsg && <p className="settings-feedback">{settingsMsg}</p>}

        <div className="settings-actions">
          <button type="submit" className="submit-btn save-btn">Simpan Pengaturan</button>
          <button type="button" className="ghost-btn" onClick={() => setShowSettings(false)}>Tutup</button>
        </div>
      </form>
    </div>
  );
}
