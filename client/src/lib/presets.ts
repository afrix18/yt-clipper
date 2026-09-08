// Cerminan ringan server/lib/presets.ts untuk UI tab Turnamen.
// "Mau video apa dulu" — tambah preset baru di sini + di server.

import type { FramingMode, CaptionPosition, VideoPresetId } from '../types';

export interface VideoPresetUi {
  id: VideoPresetId;
  label: string;
  icon: string;
  desc: string;
  framing: FramingMode;
  burnCaptionsDefault: boolean;
  captionPosDefault: CaptionPosition;
  maxMomentsDefault: number;
}

export const VIDEO_PRESET_UI: Record<VideoPresetId, VideoPresetUi> = {
  mlbb: {
    id: 'mlbb',
    label: 'MLBB YouTube',
    icon: '📺',
    desc: '4:3 landscape · tanpa teks',
    framing: 'mlbb',
    burnCaptionsDefault: false,
    captionPosDefault: 'bottom',
    maxMomentsDefault: 20,
  },
  'mlbb-vertical': {
    id: 'mlbb-vertical',
    label: 'MLBB HP / Shorts',
    icon: '📱',
    desc: '9:16 vertikal · teks otomatis',
    framing: 'mlbb-vertical',
    burnCaptionsDefault: true,
    captionPosDefault: 'bottom',
    maxMomentsDefault: 20,
  },
  podcast: {
    id: 'podcast',
    label: 'Podcast Clip',
    icon: '🎙️',
    desc: '9:16 · 60–180s · caption bawah',
    framing: 'crop',
    burnCaptionsDefault: true,
    captionPosDefault: 'bottom',
    maxMomentsDefault: 10,
  },
  streamer: {
    id: 'streamer',
    label: 'Streamer Shorts',
    icon: '⚡',
    desc: '9:16 split · 15–90s',
    framing: 'streamer',
    burnCaptionsDefault: true,
    captionPosDefault: 'middle',
    maxMomentsDefault: 10,
  },
};

export const TOURNAMENT_PRESETS: VideoPresetId[] = ['mlbb', 'mlbb-vertical', 'podcast'];
