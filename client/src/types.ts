export type ClipMeta = {
  id: string;
  title: string;
  channel?: string;
  sourceUrl: string;
  startSec: number;
  endSec: number;
  duration: number;
  durationFormatted: string;
  framing?: 'smart' | 'streamer' | 'blur' | 'crop' | 'landscape' | 'mlbb' | 'mlbb-vertical';
  facecamPos?: string;
  quality?: '1080p' | '720p';
  resolution?: string;
  hasCaptions?: boolean;
  filename: string;
  fileSize: number;
  fileSizeMB: string;
  createdAt: string;
  transcript: string | null;
  virality: {
    total: number;
    grade: string;
    scores: Record<string, number>;
    tips: string[];
  } | null;
};

export type ViralMoment = {
  title: string;
  startSec: number;
  endSec: number;
  duration: number;
  viralityScore: number;
  hook: string;
  reason: string;
  selected?: boolean;
};

export type GameBreak = {
  time: number;
  label: string;
  source: string;
};

export type Step = 'video' | 'moments' | 'clips' | 'publish';
export type CreateMode = 'auto' | 'manual';
export type Platform = 'youtube' | 'tiktok' | 'facebook' | 'instagram';
export type FramingMode = 'smart' | 'streamer' | 'blur' | 'crop' | 'landscape' | 'mlbb' | 'mlbb-vertical';
export type VideoPresetId = 'streamer' | 'mlbb' | 'mlbb-vertical' | 'podcast';
export type FacecamPosition = 'auto' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
export type QualityMode = '1080p' | '720p';
export type CaptionPosition = 'middle' | 'top' | 'bottom';

export type BatchCaption = { title: string; description: string; hashtags: string[] };
