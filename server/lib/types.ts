// Shared server-side types.
export interface ServerConfig {
  provider: string;
  groqApiKey: string;
  openaiApiKey: string;
}

export interface ClipVirality {
  total: number;
  grade: string;
  scores: Record<string, number>;
  tips: string[];
}

export interface ClipMeta {
  id: string;
  title: string;
  channel: string;
  sourceUrl: string;
  startSec: number;
  endSec: number;
  duration: number;
  durationFormatted: string;
  framing: string;
  facecamPos?: string;
  quality: string;
  resolution: string;
  hasCaptions: boolean;
  captionPos?: string;
  filename: string;
  fileSize: number;
  fileSizeMB: string;
  createdAt: string;
  transcript: string | null;
  virality: ClipVirality | null;
}

export interface UploadItem {
  title: string;
  description?: string;
  hashtags?: string[];
  channelName?: string;
  isScheduled?: boolean;
  scheduleTime?: string | null;
  clipId?: string;
  videoUrl?: string;
  filename?: string;
  autoPublish?: boolean;
  timestamp?: number;
  queueIndex?: number;
  queueTotal?: number;
  [key: string]: unknown;
}

export interface CmdResult {
  stdout: string;
  stderr: string;
}

export type LineHandler = (line: string) => void;
