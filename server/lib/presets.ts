// Registry preset jenis video — satu sumber kebenaran untuk alur
// "mau video apa dulu": streamer / mlbb / podcast.
// Tambah preset baru = tambah 1 entry di sini (+ cerminan client).

export type VideoPresetId = 'streamer' | 'mlbb' | 'mlbb-vertical' | 'podcast';

export interface VideoPreset {
  id: VideoPresetId;
  label: string;
  framing: string;
  uploadKind: 'shorts' | 'regular';
  burnCaptionsDefault: boolean;
  captionPosDefault: 'middle' | 'top' | 'bottom';
  matchMode: boolean;
  detectGames: boolean;
  targetDuration: 'auto' | 'short' | 'medium' | 'long' | 'custom';
  minDuration: number;
  maxDuration: number;
  maxMomentsDefault: number;
  durationRule: string;
}

export const VIDEO_PRESETS: Record<VideoPresetId, VideoPreset> = {
  streamer: {
    id: 'streamer',
    label: 'Streamer Shorts',
    framing: 'streamer',
    uploadKind: 'shorts',
    burnCaptionsDefault: true,
    captionPosDefault: 'middle',
    matchMode: false,
    detectGames: false,
    targetDuration: 'auto',
    minDuration: 15,
    maxDuration: 90,
    maxMomentsDefault: 10,
    durationRule: 'Berdurasi fleksibel & alami antara 15 detik sampai 90 detik.',
  },
  mlbb: {
    id: 'mlbb',
    label: 'MLBB 4:3 YouTube',
    framing: 'mlbb',
    uploadKind: 'regular',
    burnCaptionsDefault: false,
    captionPosDefault: 'bottom',
    matchMode: true,
    detectGames: true,
    targetDuration: 'custom',
    minDuration: 60,
    maxDuration: 300,
    maxMomentsDefault: 20,
    durationRule: 'Berdurasi WAR FULL antara 60 detik sampai 300 detik: mencakup setup, teamfight utuh, dan hasilnya. Jangan dipotong jadi hook kilat.',
  },
  'mlbb-vertical': {
    id: 'mlbb-vertical',
    label: 'MLBB Vertikal Shorts',
    framing: 'mlbb-vertical',
    uploadKind: 'shorts',
    burnCaptionsDefault: true,
    captionPosDefault: 'bottom',
    matchMode: true,
    detectGames: true,
    targetDuration: 'custom',
    minDuration: 60,
    maxDuration: 300,
    maxMomentsDefault: 20,
    durationRule: 'Berdurasi WAR FULL antara 60 detik sampai 300 detik: mencakup setup, teamfight utuh, dan hasilnya. Jangan dipotong jadi hook kilat.',
  },
  podcast: {
    id: 'podcast',
    label: 'Podcast Clip',
    framing: 'crop',
    uploadKind: 'shorts',
    burnCaptionsDefault: true,
    captionPosDefault: 'bottom',
    matchMode: false,
    detectGames: false,
    targetDuration: 'long',
    minDuration: 60,
    maxDuration: 180,
    maxMomentsDefault: 10,
    durationRule: 'Berdurasi PANJANG antara 60 detik sampai 180 detik: satu argumen/cerita tuntas, jangan mulai/berakhir di tengah kalimat penting.',
  },
};

export function resolvePreset(id: unknown, fallback: VideoPresetId = 'streamer'): VideoPreset {
  return (typeof id === 'string' && (VIDEO_PRESETS as Record<string, VideoPreset>)[id]) || VIDEO_PRESETS[fallback];
}
