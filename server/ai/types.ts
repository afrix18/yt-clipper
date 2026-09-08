// Shared AI-service types.
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  [key: string]: unknown;
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptData {
  text: string;
  segments: TranscriptSegment[];
  words?: TranscriptWord[];
}

export interface MomentCandidate {
  title?: string;
  startSec: number;
  endSec: number;
  hook?: string;
  reason?: string;
  quote?: string;
  [key: string]: unknown;
}

export interface ScoredMoment extends MomentCandidate {
  duration: number;
  viralityScore: number;
}

export interface RankedMoment extends MomentCandidate {
  _hook: number;
  _completeness: number;
  _emotion: number;
}

export interface SignalPeak {
  time: number;
  energy: number;
  source: string;
  emotion?: string;
}

export interface FusedRegion {
  start: number;
  end: number;
  center: number;
  sources: string[];
}

export interface TranscriptWindow {
  start: number;
  end: number;
  text: string;
}

export interface GameBreak {
  time: number;
  label: string;
  source: string;
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface DetectOptions {
  audioPath?: string;
  ffmpegPath?: string;
  reactionVideoPath?: string | null;
  maxMoments?: number;
  maxRegions?: number;
  matchMode?: boolean;
}

export type ProgressCallback = (p: { percent: number; stage: string }) => void;
