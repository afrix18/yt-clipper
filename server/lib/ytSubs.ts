import * as path from 'path';
import * as fs from 'fs';
import { runCmd } from './proc';
import type { TranscriptData, TranscriptSegment, TranscriptWord } from '../ai/types';

/**
 * Parse VTT subtitle text into TranscriptData format (text, segments, words)
 */
export function parseVttToTranscript(vttContent: string): TranscriptData {
  const lines = vttContent.split(/\r?\n/);
  const segments: TranscriptSegment[] = [];
  const words: TranscriptWord[] = [];
  let fullText = '';

  const timeRegex = /(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})/;

  function toSeconds(h: string | undefined, m: string, s: string, ms: string): number {
    const hours = h ? parseInt(h, 10) : 0;
    const mins = parseInt(m, 10);
    const secs = parseInt(s, 10);
    const millis = parseInt(ms, 10);
    return hours * 3600 + mins * 60 + secs + millis / 1000;
  }

  let currentStart = 0;
  let currentEnd = 0;
  let currentTextLines: string[] = [];

  const flushSegment = () => {
    if (currentTextLines.length > 0 && currentEnd > currentStart) {
      // Remove HTML / VTT formatting tags like <c>, </c>, <00:01:23.456>
      const cleanText = currentTextLines
        .join(' ')
        .replace(/<\/?[^>]+(>|$)/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (cleanText && cleanText.length > 1) {
        segments.push({ start: currentStart, end: currentEnd, text: cleanText });
        fullText += (fullText ? ' ' : '') + cleanText;

        const tokens = cleanText.split(/\s+/).filter(Boolean);
        const dur = currentEnd - currentStart;
        const wordDur = dur / Math.max(1, tokens.length);
        tokens.forEach((t, idx) => {
          words.push({
            word: t,
            start: currentStart + idx * wordDur,
            end: currentStart + (idx + 1) * wordDur,
          });
        });
      }
    }
    currentTextLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(timeRegex);
    if (match) {
      flushSegment();
      currentStart = toSeconds(match[1], match[2], match[3], match[4]);
      currentEnd = toSeconds(match[5], match[6], match[7], match[8]);
    } else if (line && !line.startsWith('WEBVTT') && !line.startsWith('Kind:') && !line.startsWith('Language:') && !line.startsWith('NOTE')) {
      if (currentEnd > 0) {
        currentTextLines.push(line);
      }
    }
  }
  flushSegment();

  return { text: fullText, segments, words };
}

/**
 * Attempt to download YouTube auto-generated or manual subtitles via yt-dlp.
 * Returns TranscriptData if successful, or null if subtitles are not available.
 */
export async function tryFetchYouTubeSubtitles(
  youtubeUrl: string,
  ytdlpPath: string,
  outDir: string
): Promise<TranscriptData | null> {
  const prefix = path.join(outDir, 'ytsub');
  try {
    // Check and download id, en, or any auto-subs directly in VTT format (no audio/video download)
    const cmd = `"${ytdlpPath}" --write-auto-sub --write-sub --sub-lang "id,en,id-orig,en-orig" --sub-format vtt --skip-download --no-warnings -o "${prefix}.%(ext)s" "${youtubeUrl}"`;
    await runCmd(cmd);

    const files = fs.readdirSync(outDir);
    const vttFile = files.find((f) => f.startsWith('ytsub.') && f.endsWith('.vtt'));
    if (!vttFile) return null;

    const fullPath = path.join(outDir, vttFile);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const transcript = parseVttToTranscript(content);

    // Clean up temporary vtt files
    files.filter((f) => f.startsWith('ytsub.')).forEach((f) => {
      try { fs.unlinkSync(path.join(outDir, f)); } catch {}
    });

    if (transcript.segments.length > 0 && transcript.text.length > 50) {
      return transcript;
    }
    return null;
  } catch (err) {
    console.log('[YouTube Subs] Subtitle fetch skipped or not available:', (err as Error).message);
    return null;
  }
}
