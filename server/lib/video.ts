// Pembangun filter-graph FFmpeg per framing.
// Satu cabang per mode (tidak bersarang) — tiap mode menghasilkan
// label stream video yang di-map ke output.

export type Framing = 'smart' | 'streamer' | 'blur' | 'crop' | 'landscape' | 'mlbb' | 'mlbb-vertical';

interface StreamerBox {
  w: number;
  h: number;
  x: number;
  y: number;
}

interface DetectionData {
  streamer?: { cam?: StreamerBox; game?: StreamerBox };
  smartCrop?: { cropX?: number };
}

export interface FilterGraph {
  filterComplex: string;
  videoLabel: string;
}

const ENCODE_TAIL = (videoLabel: string): string[] => [
  '-map', videoLabel,
  '-map', '0:a?',
  '-c:v', 'libx264',
  '-preset', 'veryfast',
  '-c:a', 'aac',
  '-progress', 'pipe:1',
];

export function withSubtitles(filterComplex: string, escapedAss: string | null): { filterComplex: string; videoLabel: string } {
  if (!escapedAss) return { filterComplex, videoLabel: '[v]' };
  return { filterComplex: `${filterComplex};[v]subtitles='${escapedAss}'[vout]`, videoLabel: '[vout]' };
}

function streamerGraph(targetW: number, topH: number, botH: number, detection: DetectionData | null): string {
  const cam = detection?.streamer?.cam;
  const game = detection?.streamer?.game;
  if (cam && game) {
    return `[0:v]crop=${cam.w}:${cam.h}:${cam.x}:${cam.y},scale=${targetW}:${topH}:force_original_aspect_ratio=increase,crop=${targetW}:${topH}[cam];`
      + `[0:v]crop=${game.w}:${game.h}:${game.x}:${game.y},scale=${targetW}:${botH}:force_original_aspect_ratio=increase,crop=${targetW}:${botH}[game];`
      + `[cam][game]vstack[v]`;
  }
  // Fallback streamer split if detection failed
  return `[0:v]crop=in_w*0.4:in_h*0.5:in_w*0.6:in_h*0.5,scale=${targetW}:${topH}[cam];`
    + `[0:v]crop=in_h*0.95:in_h:(in_w-in_h*0.95)/2:0,scale=${targetW}:${botH}[game];`
    + `[cam][game]vstack[v]`;
}

export interface RenderTargets {
  targetW: number;
  targetH: number;
  is1080p: boolean;
  isLandscape: boolean;
}

export function resolveTargets(framing: string, quality: string): RenderTargets {
  const is1080p = quality === '1080p';
  const isLandscape = framing === 'landscape';
  const isMlbb = framing === 'mlbb';
  return {
    is1080p,
    isLandscape,
    targetW: isMlbb
      ? (is1080p ? 1440 : 960)
      : isLandscape
        ? (is1080p ? 1920 : 1280)
        : (is1080p ? 1080 : 720),
    targetH: isMlbb
      ? (is1080p ? 1080 : 720)
      : isLandscape
        ? (is1080p ? 1080 : 720)
        : (is1080p ? 1920 : 1280),
  };
}

export function framingLabel(framing: string): string {
  switch (framing) {
    case 'streamer': return 'Mode Streamer';
    case 'mlbb': return 'MLBB Turnamen (4:3)';
    case 'mlbb-vertical': return 'MLBB Vertikal (HP)';
    case 'smart': return 'Smart Auto-Crop';
    case 'landscape': return 'Landscape (Video Reguler)';
    case 'blur': return 'Blur BG';
    default: return 'Crop Tengah';
  }
}

export function buildFilterGraph(
  framing: Framing | string,
  targets: RenderTargets,
  detection: DetectionData | null,
  escapedAss: string | null,
): FilterGraph {
  const { targetW, targetH, is1080p } = targets;
  let base: string;

  if (framing === 'streamer') {
    // Stacked split-screen: Top Facecam + Bottom Game
    const topH = is1080p ? 780 : 520;
    const botH = is1080p ? 1140 : 760;
    base = streamerGraph(targetW, topH, botH, detection);
  } else if (framing === 'mlbb') {
    // MLBB turnamen 4:3 — crop tengah dari source 16:9 (buang kiri-kanan,
    // HUD tengah/minimap tetap utuh), tanpa facecam.
    base = `[0:v]crop=in_h*4/3:in_h:(in_w-in_h*4/3)/2:0,scale=${targetW}:${targetH},setsar=1[v]`;
  } else if (framing === 'mlbb-vertical') {
    // MLBB vertikal untuk HP/Reels/Shorts: konten 3:4 di tengah kanvas 9:16
    // dengan blur-fill atas-bawah (layar penuh, HUD 3:4 utuh).
    const fgH = is1080p ? 1440 : 960;
    base = `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=25:5[bg];`
      + `[0:v]crop=in_h*3/4:in_h:(in_w-in_h*3/4)/2:0,scale=${targetW}:${fgH},setsar=1[fg];`
      + `[bg][fg]overlay=(W-w)/2:(H-h)/2[v]`;
  } else if (framing === 'landscape') {
    // Landscape pass-through 16:9 (potongan game / video reguler):
    // scale-down saja + pad pengaman dimensi ganjil, tanpa crop.
    base = `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2[v]`;
  } else if (framing === 'blur') {
    base = `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=25:5[bg];[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[v]`;
  } else if (framing === 'smart') {
    // Smart Auto-Crop centered on detected person
    let cropX = '(in_w-in_h*9/16)/2';
    if (detection?.smartCrop?.cropX != null) {
      cropX = String(detection.smartCrop.cropX);
    }
    base = `[0:v]crop=in_h*9/16:in_h:${cropX}:0,scale=${targetW}:${targetH}[v]`;
  } else {
    // Static center crop ('crop' + fallback tak dikenal)
    base = `[0:v]crop=in_h*9/16:in_h:(in_w-in_h*9/16)/2:0,scale=${targetW}:${targetH}[v]`;
  }

  const { filterComplex, videoLabel } = withSubtitles(base, escapedAss);
  return { filterComplex, videoLabel };
}

export function buildFfmpegArgs(
  downloadPath: string,
  clipPath: string,
  graph: FilterGraph,
): string[] {
  return [
    '-y',
    '-i', downloadPath,
    '-filter_complex', graph.filterComplex,
    ...ENCODE_TAIL(graph.videoLabel),
    clipPath,
  ];
}
