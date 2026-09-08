import * as fs from 'fs';
import * as path from 'path';
import { runCmd } from '../lib/proc';
import type { TranscriptData, TranscriptSegment, TranscriptWord } from './types';

// ── Single File Whisper API Caller with Multi-Key Rotation & Retry ─────
export async function callWhisperApi(filePath: string, rawApiKey: string, provider = 'groq', retryCount = 1): Promise<any> {
  const keys = rawApiKey.split(',').map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) throw new Error('API Key belum diisi. Buka menu Settings ⚙️.');

  const audioBuffer: Buffer = fs.readFileSync(filePath);
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mp3' });

  let endpoint = 'https://api.groq.com/openai/v1/audio/transcriptions';
  let models = ['whisper-large-v3-turbo', 'whisper-large-v3'];

  if (provider === 'openai') {
    endpoint = 'https://api.openai.com/v1/audio/transcriptions';
    models = ['whisper-1'];
  }

  let lastErr: unknown = null;

  for (let keyIdx = 0; keyIdx < keys.length; keyIdx++) {
    const apiKey = keys[keyIdx];
    const headers = { 'Authorization': `Bearer ${apiKey}` };
    let rotateToNextKey = false;

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      if (rotateToNextKey) break;

      for (const model of models) {
        try {
          const formData = new FormData();
          formData.append('file', blob, 'audio.mp3');
          formData.append('model', model);
          formData.append('response_format', 'verbose_json');
          formData.append('temperature', '0');
          formData.append('timestamp_granularities[]', 'word');
          formData.append('timestamp_granularities[]', 'segment');

          const keyLabel = keys.length > 1 ? `[key ${keyIdx + 1}/${keys.length}] ` : '';
          console.log(`[AI] ${keyLabel}Sending audio (${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB) to ${provider} (${model})...`);
          const res = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: formData,
          });

          if (!res.ok) {
            const errText = await res.text();
            console.warn(`[AI] Model ${model} returned error (${res.status}): ${errText}`);
            if (res.status === 429) {
              if (keyIdx < keys.length - 1) {
                console.log(`[AI] 🔄 Key ${keyIdx + 1} terkena limit 429. Mengalihkan otomatis ke Key ${keyIdx + 2}...`);
                rotateToNextKey = true;
                break;
              }
              let waitMsg = '';
              try {
                const errJson = JSON.parse(errText);
                const msg = errJson.error?.message || '';
                const match = msg.match(/try again in ([\w\d.]+)/i);
                if (match) {
                  waitMsg = ` Silakan tunggu ${match[1]} atau masukkan API Key Groq baru di menu Settings.`;
                }
              } catch {}
              throw new Error(`Batas kuota audio Groq per jam (7.200 detik) tercapai.${waitMsg || ' Silakan tunggu beberapa menit atau masukkan API Key Groq baru di menu Settings ⚙️.'}`);
            }
            lastErr = new Error(`Speech AI error (${res.status}): ${errText}`);
            continue;
          }

          const data: any = await res.json();
          console.log(`[AI] ✅ Transcription success with ${model}! (Words: ${data.words?.length || 0})`);
          return data;
        } catch (err: any) {
          if (err.message && err.message.includes('Batas kuota audio Groq')) {
            throw err;
          }
          console.warn(`[AI] Fetch attempt ${attempt + 1} with ${model} failed (${(err as Error).message}).`);
          lastErr = err;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
  }

  throw (lastErr as Error) || new Error('Gagal menghubungi Speech AI setelah beberapa percobaan.');
}

// ── Transcribe Audio via Cloud Speech AI (With Auto Chunking, Resume & Caching) ──
export async function transcribeAudio(
  audioPath: string,
  apiKey: string,
  provider = 'groq',
  ffmpegPath = 'ffmpeg',
  cacheDir?: string,
  onProgress?: (p: { current: number; total: number; stage: string }) => void
): Promise<TranscriptData> {
  if (!apiKey) throw new Error('API Key belum diisi. Buka menu Settings ⚙️ untuk mengisi API Key.');

  // Check if complete transcript is already cached
  const fullTranscriptFile = cacheDir ? path.join(cacheDir, 'transcript.json') : null;
  if (fullTranscriptFile && fs.existsSync(fullTranscriptFile)) {
    try {
      const cachedData = JSON.parse(fs.readFileSync(fullTranscriptFile, 'utf-8'));
      if (cachedData && (cachedData.text || (cachedData.segments && cachedData.segments.length > 0))) {
        console.log(`[AI] ⚡ Full transcript loaded from cache! (${cachedData.segments?.length || 0} segments). Skipping Whisper API.`);
        onProgress?.({ current: 1, total: 1, stage: '⚡ Transkripsi dimuat dari cache lokal (Whisper dilewati)...' });
        return cachedData;
      }
    } catch (e) {
      console.warn('[AI] Cached transcript corrupted, will re-transcribe:', e);
    }
  }

  const stats = fs.statSync(audioPath);
  const sizeMB = stats.size / (1024 * 1024);

  // If under 6MB, send directly (super fast, prevents ECONNRESET)
  if (sizeMB <= 6) {
    onProgress?.({ current: 1, total: 1, stage: 'Mentranskripsi audio dengan Speech AI...' });
    const data = await callWhisperApi(audioPath, apiKey, provider);
    const result: TranscriptData = {
      text: data.text || '',
      segments: data.segments || [],
      words: data.words || [],
    };
    if (fullTranscriptFile) {
      fs.writeFileSync(fullTranscriptFile, JSON.stringify(result, null, 2), 'utf-8');
    }
    return result;
  }

  console.log(`[AI] Audio file (${sizeMB.toFixed(2)} MB) is large. Chunking to 8-minute segments...`);
  const chunksDir = cacheDir ? path.join(cacheDir, 'chunks') : path.dirname(audioPath);
  if (!fs.existsSync(chunksDir)) fs.mkdirSync(chunksDir, { recursive: true });

  const chunkTemplate = path.join(chunksDir, 'chunk_%03d.mp3');
  const segmentDurationSec = 480; // 8 minutes per chunk (~1.5 MB each)

  // Only split if chunks don't already exist
  let chunkFiles = fs.readdirSync(chunksDir).filter((f: string) => f.startsWith('chunk_') && f.endsWith('.mp3')).sort();
  if (chunkFiles.length === 0) {
    const splitCmd = `"${ffmpegPath}" -y -i "${audioPath}" -f segment -segment_time ${segmentDurationSec} -c:a libmp3lame -b:a 24k -ar 16000 -ac 1 "${chunkTemplate}"`;
    await runCmd(splitCmd);
    chunkFiles = fs.readdirSync(chunksDir).filter((f: string) => f.startsWith('chunk_') && f.endsWith('.mp3')).sort();
  }

  console.log(`[AI] Total ${chunkFiles.length} chunks. Transcribing sequentially with cache resume...`);

  let fullText = '';
  const allSegments: TranscriptSegment[] = [];
  const allWords: TranscriptWord[] = [];

  for (let i = 0; i < chunkFiles.length; i++) {
    const chunkFile = path.join(chunksDir, chunkFiles[i]);
    const chunkBase = path.basename(chunkFiles[i], '.mp3');
    const chunkJson = path.join(chunksDir, `${chunkBase}.json`);
    const offsetSec = i * segmentDurationSec;

    let chunkData: any = null;
    if (fs.existsSync(chunkJson)) {
      try {
        chunkData = JSON.parse(fs.readFileSync(chunkJson, 'utf-8'));
        console.log(`[AI] ⚡ Chunk ${i + 1}/${chunkFiles.length} loaded from local cache!`);
        onProgress?.({
          current: i + 1,
          total: chunkFiles.length,
          stage: `⚡ Memuat chunk ${i + 1}/${chunkFiles.length} dari cache...`,
        });
      } catch {
        chunkData = null;
      }
    }

    if (!chunkData) {
      console.log(`[AI] Transcribing chunk ${i + 1}/${chunkFiles.length} (Time offset: ${offsetSec}s)...`);
      onProgress?.({
        current: i + 1,
        total: chunkFiles.length,
        stage: `Mentranskripsi chunk ${i + 1}/${chunkFiles.length} (${Math.round(offsetSec / 60)}m)...`,
      });
      chunkData = await callWhisperApi(chunkFile, apiKey, provider);
      fs.writeFileSync(chunkJson, JSON.stringify(chunkData, null, 2), 'utf-8');
    }

    if (chunkData.text) {
      fullText += (fullText ? ' ' : '') + chunkData.text.trim();
    }
    if (chunkData.segments && Array.isArray(chunkData.segments)) {
      for (const seg of chunkData.segments) {
        allSegments.push({
          ...seg,
          start: seg.start + offsetSec,
          end: seg.end + offsetSec,
        });
      }
    }
    if (chunkData.words && Array.isArray(chunkData.words)) {
      for (const w of chunkData.words) {
        allWords.push({
          word: w.word,
          start: w.start + offsetSec,
          end: w.end + offsetSec,
        });
      }
    }
  }

  const completeResult: TranscriptData = { text: fullText, segments: allSegments, words: allWords };
  if (fullTranscriptFile) {
    fs.writeFileSync(fullTranscriptFile, JSON.stringify(completeResult, null, 2), 'utf-8');
    console.log(`[AI] 💾 Full transcript saved to cache: ${fullTranscriptFile}`);
  }

  return completeResult;
}
