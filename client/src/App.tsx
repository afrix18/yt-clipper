import { useState, useEffect } from 'react';
import './App.css';
import type { Step, ClipMeta } from './types';
import { useSettings } from './hooks/useSettings';
import { useClips } from './hooks/useClips';
import { useTournament } from './hooks/useTournament';
import { useUpload } from './hooks/useUpload';
import { useJobs } from './hooks/useJobs';
import { StepsNav } from './components/StepsNav';
import { JobsBanner } from './components/JobsBanner';
import { VideoPage } from './components/VideoPage';
import { MomentsPage } from './components/MomentsPage';
import { HistoryPanel } from './components/HistoryPanel';
import { PublishPage } from './components/PublishPage';

declare const chrome: any;

function App() {
  const [step, setStep] = useState<Step>('video');

  const settings = useSettings();
  const clipsApi = useClips();
  const { fetchClips, downloadClip } = clipsApi;

  const studio = useTournament({
    fetchClips,
    downloadClip,
    groqKeyInput: settings.groqKeyInput,
    openaiKeyInput: settings.openaiKeyInput,
    aiProvider: settings.aiProvider,
    hasGroqKey: settings.hasGroqKey,
    hasOpenaiKey: settings.hasOpenaiKey,
    setShowSettings: () => setStep('video'),
  });

  const upload = useUpload({ clips: clipsApi.clips, downloadClip });
  const jobsApi = useJobs();

  useEffect(() => {
    settings.fetchSettings();
    fetchClips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUploadClip = (clip: ClipMeta) => {
    upload.setSelectedClipId(clip.id);
    setStep('publish');
  };

  const openLibrary = () => {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.getURL && chrome.tabs?.create) {
        chrome.tabs.create({ url: chrome.runtime.getURL('dist/library.html') });
        return;
      }
    } catch { /* fallback di bawah */ }
    window.open('dist/library.html', '_blank');
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="app-logo-text">C</div>
        <div className="app-header-text">
          <h1>Clipper</h1>
          <p>Potong video panjang jadi klip siap tayang</p>
        </div>
      </header>

      <JobsBanner
        jobsApi={jobsApi}
        onGoMoments={() => setStep('moments')}
        onGoClips={() => setStep('clips')}
      />

      <StepsNav
        step={step}
        onGo={(s) => { setStep(s); if (s === 'clips') fetchClips(); }}
        momentsCount={studio.detectedMoments.length}
        clipsCount={clipsApi.clips.length}
      />

      {step === 'video' && (
        <VideoPage studio={studio} settings={settings} onAnalyzed={() => setStep('moments')} />
      )}

      {step === 'moments' && (
        <MomentsPage studio={studio} onRendered={() => { setStep('clips'); }} onGoVideo={() => setStep('video')} />
      )}

      {step === 'clips' && (
        <>
          <button type="button" className="ghost-btn" style={{ width: '100%' }} onClick={openLibrary}>
            Buka Tampilan Lebar (tab baru)
          </button>
          <HistoryPanel clips={clipsApi} onUploadClip={handleUploadClip} onGoVideo={() => setStep('video')} />
        </>
      )}

      {step === 'publish' && (
        <PublishPage upload={upload} clips={clipsApi.clips} onGoClips={() => setStep('clips')} />
      )}

      <footer className="app-footer">
        <p>Clipper v3.0</p>
        <div className="footer-badge">
          <span className="dot" />
          Server lokal port 3002
        </div>
      </footer>
    </div>
  );
}

export default App;
