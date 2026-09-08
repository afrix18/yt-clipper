import type { TranscriptSegment, TranscriptWord } from './types';

// Helper to format seconds to ASS timestamp (h:mm:ss.cc)
export function formatAssTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

// ── Generate ASS Subtitle with TikTok / Shorts Style (Word-Level Timing) ──
export function generateAssSubtitle(transcriptInput: unknown, startSec = 0, endSec = 0, is1080p = true, captionPos = 'middle', framing: string = 'vertical'): string {
  const isMlbb = framing === 'mlbb';
  const playResX = isMlbb ? (is1080p ? 1440 : 960) : (is1080p ? 1080 : 720);
  const playResY = isMlbb ? (is1080p ? 1080 : 720) : (is1080p ? 1920 : 1280);
  const fontSize = isMlbb ? (is1080p ? 56 : 38) : (is1080p ? 70 : 46);
  const outlineWidth = is1080p ? 6 : 4;

  // Vertical margin from bottom edge (Alignment 2 = bottom-center)
  // Raised significantly so it does not cover the person/streamer or get covered by Shorts/TikTok UI.
  // Kanvas 4:3 (MLBB) lebih pendek — margin disesuaikan agar teks di zona bawah aman.
  let marginV: number;
  if (isMlbb) {
    if (captionPos === 'top') {
      marginV = is1080p ? 760 : 505;
    } else if (captionPos === 'middle') {
      marginV = is1080p ? 540 : 360;
    } else {
      marginV = is1080p ? 220 : 150;
    }
  } else if (captionPos === 'top') {
    marginV = is1080p ? 1320 : 880; // Upper third
  } else if (captionPos === 'bottom') {
    marginV = is1080p ? 560 : 375; // Lower zone, safely above UI buttons
  } else {
    // Default 'middle' (Centered in safe zone): y ≈ 1070/1920
    // Perfectly positioned above streamer facecam / torso and below face!
    marginV = is1080p ? 850 : 565;
  }

  const assHeader = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: TikTok,Arial,${fontSize},&H0000FFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${outlineWidth},2,2,40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events: string[] = [];

  // Parse words & segments from transcriptInput
  let words: TranscriptWord[] = [];
  let segments: TranscriptSegment[] = [];

  if (transcriptInput && typeof transcriptInput === 'object') {
    const input = transcriptInput as { words?: unknown; segments?: unknown };
    if (Array.isArray(input.words)) words = input.words as TranscriptWord[];
    if (Array.isArray(input.segments)) segments = input.segments as TranscriptSegment[];
    if (Array.isArray(transcriptInput)) {
      if (transcriptInput.length > 0 && (transcriptInput[0] as any).word !== undefined) {
        words = transcriptInput as TranscriptWord[];
      } else {
        segments = transcriptInput as TranscriptSegment[];
      }
    }
  }

  // 1️⃣ Priority: Millisecond-Accurate Word Timestamps
  if (words && words.length > 0) {
    // If words are in absolute video time (> startSec), offset them
    const validWords = words
      .map((w) => {
        let s = w.start;
        let e = w.end;
        if (startSec > 0 && s >= startSec - 1) {
          s = Math.max(0, s - startSec);
          e = Math.max(0, e - startSec);
        }
        return {
          word: (w.word || '').trim(),
          start: s,
          end: e,
        };
      })
      .filter((w) => w.word.length > 0 && w.end > w.start);

    // Group into short, punchy 2-3 word chunks based on speech pacing
    const chunks: TranscriptWord[][] = [];
    let currentChunk: TranscriptWord[] = [];

    for (let i = 0; i < validWords.length; i++) {
      const w = validWords[i];
      const prev = currentChunk[currentChunk.length - 1];

      // Break chunk if:
      // - Already 3 words
      // - Or character count >= 18
      // - Or pause between words > 0.32s (speaker paused/took breath)
      // - Or previous word ends with punctuation (. ? ! ,)
      const charCount = currentChunk.reduce((acc, x) => acc + x.word.length, 0);
      const isPause = prev && (w.start - prev.end > 0.32);
      const isPunctuation = prev && /[.?!,]$/.test(prev.word);

      if (currentChunk.length >= 3 || charCount >= 18 || isPause || isPunctuation) {
        if (currentChunk.length > 0) chunks.push(currentChunk);
        currentChunk = [w];
      } else {
        currentChunk.push(w);
      }
    }
    if (currentChunk.length > 0) chunks.push(currentChunk);

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const nextC = chunks[i + 1];

      const cStart = c[0].start;
      const rawEnd = c[c.length - 1].end;
      let cEnd = rawEnd;

      if (nextC) {
        const nextStart = nextC[0].start;
        if (nextStart > rawEnd) {
          const gap = nextStart - rawEnd;
          if (gap < 0.25) {
            // Short gap between syllables/words: bridge smoothly without overlap
            cEnd = nextStart - 0.01;
          } else {
            // Speaker paused: hold for 0.15s then disappear during silence!
            cEnd = Math.min(rawEnd + 0.15, nextStart - 0.05);
          }
        } else {
          // Words are immediately back-to-back
          cEnd = nextStart;
        }
      } else {
        // Last chunk: hold for 0.25s then disappear
        cEnd = rawEnd + 0.25;
      }

      // Safety check: end must be strictly greater than start
      if (cEnd <= cStart) cEnd = cStart + 0.2;

      const text = c.map((x) => x.word.toUpperCase()).join(' ');
      events.push(`Dialogue: 0,${formatAssTime(cStart)},${formatAssTime(cEnd)},TikTok,,0,0,0,,${text}`);
    }
  } else if (segments && segments.length > 0) {
    // 2️⃣ Fallback: Segment-based with proportional pacing
    const relevant = segments.filter((s) => s.end >= startSec && s.start <= (endSec || Infinity));
    for (const seg of relevant) {
      const segStart = Math.max(0, seg.start - startSec);
      const segEnd = Math.min((endSec || seg.end) - startSec, seg.end - startSec);
      if (segEnd <= segStart) continue;

      const wordsInSeg = (seg.text || '').trim().split(/\s+/).filter(Boolean);
      if (wordsInSeg.length === 0) continue;

      const chunkSize = 3;
      const totalWords = wordsInSeg.length;
      const numChunks = Math.ceil(totalWords / chunkSize);
      const totalDuration = segEnd - segStart;
      const chunkDuration = totalDuration / numChunks;

      for (let i = 0; i < numChunks; i++) {
        const chunkWords = wordsInSeg.slice(i * chunkSize, (i + 1) * chunkSize).join(' ').toUpperCase();
        const cStart = segStart + (i * chunkDuration);
        const cEnd = Math.min(segEnd, cStart + chunkDuration);

        events.push(`Dialogue: 0,${formatAssTime(cStart)},${formatAssTime(cEnd)},TikTok,,0,0,0,,${chunkWords}`);
      }
    }
  }

  return assHeader + events.join('\n') + '\n';
}
