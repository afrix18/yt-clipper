import { useState, useEffect } from 'react';
import './App.css';
import type { Tab, ClipMeta } from './types';
import { useSettings } from './hooks/useSettings';
import { useClips } from './hooks/useClips';
import { useCreate } from './hooks/useCreate';
import { useUpload } from './hooks/useUpload';
import { SettingsModal } from './components/SettingsModal';
import { CreatePanel } from './components/CreatePanel';
import { HistoryPanel } from './components/HistoryPanel';
import { UploadPanel } from './components/UploadPanel';

declare const chrome: any;

function App() {
  const [tab, setTab] = useState<Tab>('create');

  const settings = useSettings();
  const clipsApi = useClips();
  const { fetchClips, downloadClip } = clipsApi;

  const create = useCreate({
    fetchClips,
    downloadClip,
    groqKeyInput: settings.groqKeyInput,
    openaiKeyInput: settings.openaiKeyInput,
    aiProvider: settings.aiProvider,
    hasGroqKey: settings.hasGroqKey,
    hasOpenaiKey: settings.hasOpenaiKey,
    setShowSettings: settings.setShowSettings,
  });

  const upload = useUpload({ clips: clipsApi.clips, downloadClip });

  useEffect(() => {
    settings.fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchClips]);

  const handleToggleMomentSelect = (index: number) => {
    const updated = [...create.detectedMoments];
    if (!updated[index]) return;
    updated[index] = { ...updated[index], selected: !updated[index].selected };
    create.setDetectedMoments(updated);
  };

  const handleUploadClip = (clip: ClipMeta) => {
    upload.setSelectedClipId(clip.id);
    setTab('upload');
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="app-logo">✂️</div>
        <div className="app-header-text">
          <h1>YT Short Clipper</h1>
          <p>Auto viral clip & dynamic captions</p>
        </div>
        <button
          className="settings-icon-btn"
          onClick={() => { settings.setShowSettings(!settings.showSettings); settings.setSettingsMsg(''); }}
          title="Pengaturan API Key AI"
        >
          ⚙️
        </button>
      </header>

      {/* Settings Modal */}
      <SettingsModal settings={settings} />

      {/* Tab Navigation */}
      <nav className="tab-nav">
        {([['create', '✂️', 'Buat'], ['history', '📋', 'Histori'], ['upload', '🚀', 'Upload']] as const).map(([key, icon, label]) => (
          <button
            key={key}
            className={`tab-btn ${tab === key ? 'active' : ''}`}
            onClick={() => { setTab(key as Tab); if (key === 'history') fetchClips(); }}
          >
            <span className="tab-icon">{icon}</span>
            {label}
            {key === 'history' && clipsApi.clips.length > 0 && <span className="tab-badge">{clipsApi.clips.length}</span>}
          </button>
        ))}
      </nav>

      {/* ═══ CREATE TAB ═══ */}
      {tab === 'create' && (
        <CreatePanel create={create} onToggleMomentSelect={handleToggleMomentSelect} />
      )}

      {/* ═══ HISTORY TAB ═══ */}
      {tab === 'history' && (
        <HistoryPanel clips={clipsApi} onUploadClip={handleUploadClip} onGoCreate={() => setTab('create')} />
      )}

      {/* ═══ UPLOAD TAB ═══ */}
      {tab === 'upload' && (
        <UploadPanel upload={upload} clips={clipsApi.clips} onGoCreate={() => setTab('create')} />
      )}

      {/* Footer */}
      <footer className="app-footer">
        <p>YT Short Clipper v2.5 AI</p>
        <div className="footer-badge">
          <span className="dot" />
          Server terhubung · Port 3002
        </div>
      </footer>
    </div>
  );
}

export default App;
