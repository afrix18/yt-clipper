import { useState, useCallback } from 'react';
import { API } from '../lib/api';

export function useSettings() {
  const [showSettings, setShowSettings] = useState(false);
  const [aiProvider, setAiProvider] = useState<'groq' | 'openai'>('groq');
  const [groqKeyInput, setGroqKeyInput] = useState('');
  const [openaiKeyInput, setOpenaiKeyInput] = useState('');
  const [hasGroqKey, setHasGroqKey] = useState(false);
  const [hasOpenaiKey, setHasOpenaiKey] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState('');

  // ── Fetch Settings (LocalStorage + Server Sync)
  const fetchSettings = useCallback(async () => {
    // 1. Load from localStorage first
    const localProvider = (localStorage.getItem('yt_clipper_provider') as 'groq' | 'openai') || 'groq';
    const localGroq = localStorage.getItem('yt_clipper_groq_key') || '';
    const localOpenai = localStorage.getItem('yt_clipper_openai_key') || '';

    setAiProvider(localProvider);
    if (localGroq) {
      setGroqKeyInput(localGroq);
      setHasGroqKey(true);
    }
    if (localOpenai) {
      setOpenaiKeyInput(localOpenai);
      setHasOpenaiKey(true);
    }

    // 2. Try sync with backend
    try {
      const r = await fetch(`${API}/api/settings`);
      if (r.ok) {
        const data = await r.json();
        if (data.provider) setAiProvider(data.provider);
        if (data.hasGroqKey) setHasGroqKey(true);
        if (data.hasOpenaiKey) setHasOpenaiKey(true);
        if (data.groqApiKey && !localGroq) setGroqKeyInput(data.groqApiKey);
        if (data.openaiApiKey && !localOpenai) setOpenaiKeyInput(data.openaiApiKey);
      }
    } catch { /* ignore backend offline / restarting */ }
  }, []);

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsMsg('');

    // Save to localStorage immediately (never fails)
    localStorage.setItem('yt_clipper_provider', aiProvider);
    if (groqKeyInput && !groqKeyInput.includes('••••')) {
      localStorage.setItem('yt_clipper_groq_key', groqKeyInput);
      setHasGroqKey(true);
    }
    if (openaiKeyInput && !openaiKeyInput.includes('••••')) {
      localStorage.setItem('yt_clipper_openai_key', openaiKeyInput);
      setHasOpenaiKey(true);
    }

    setSettingsMsg('✅ Pengaturan berhasil disimpan!');

    // Sync to backend
    try {
      await fetch(`${API}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: aiProvider,
          groqApiKey: groqKeyInput,
          openaiApiKey: openaiKeyInput,
        }),
      });
    } catch { /* ignore */ }

    setTimeout(() => setShowSettings(false), 1000);
  };

  return {
    showSettings, setShowSettings,
    aiProvider, setAiProvider,
    groqKeyInput, setGroqKeyInput,
    openaiKeyInput, setOpenaiKeyInput,
    hasGroqKey, hasOpenaiKey,
    settingsMsg, setSettingsMsg,
    fetchSettings, saveSettings,
  };
}

export type SettingsApi = ReturnType<typeof useSettings>;
