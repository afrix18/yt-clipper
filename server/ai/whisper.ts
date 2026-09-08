import * as fs from 'fs';
import * as path from 'path';
import { runCmd } from '../lib/proc';
import type { TranscriptData, TranscriptSegment, TranscriptWord } from './types';

// ── Single File Whisper API Caller with Retry & Fallback Models ─────
export async function callWhisperApi(filePath: string, apiKey: string, provider = 'groq', retryCount = 2): Promise<any> {
  const audioBuffer: Buffer = fs.readFileSync(filePath);
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mp3' });

  let endpoint = 'https://api.groq.com/openai/v1/audio/transcriptions';
  let models = ['whisper-large-v3-turbo', 'whisper-large-v3'];
  const headers = { 'Authorization': `Bearer ${apiKey}` };

  if (provider === 'openai') {
    endpoint = 'https://api.openai.com/v1/audio/transcriptions';
    models = ['whisper-1'];
  }

  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    for (const model of models) {
      try {
        const formData = new FormData();
        formData.append('file', blob, 'audio.mp3');
        formData.append('model', model);
        formData.append('response_format', 'verbose_json');
        formData.append('temperature', '0');
        formData.append('timestamp_granularities[]', 'word');
        formData.append('timestamp_granularities[]', 'segment');

        console.log(`[AI] Sending audio (${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB) to ${provider} (${model}) [attempt ${attempt + 1}]...`);
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: formData,
        });

        if (!res.ok) {
          const errText = await res.text();
          console.warn(`[AI] Model ${model} returned error (${res.status}): ${errText}`);
          lastErr = new Error(`Speech AI error (${res.status}): ${errText}`);
          continue;
        }

        const data: any = await res.json();
        console.log(`[AI] ✅ Transcription success with ${model}! (Words: ${data.words?.length || 0})`);
        return data;
      } catch (err) {
        console.warn(`[AI] Fetch attempt ${attempt + 1} with ${model} failed (${(err as Error).message}). Retrying...`);
        lastErr = err;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  throw (lastErr as Error) || new Error('Gagal menghubungi Speech AI setelah beberapa percobaan.');
}

// ── Transcribe Audio via Cloud Speech AI (With Auto Chunking <= 6MB) ──
export async function transcribeAudio(audioPath: string, apiKey: string, provider = 'groq', ffmpegPath = 'ffmpeg'): Promise<TranscriptData> {
  if (!apiKey) throw new Error('API Key belum diisi. Buka menu Settings ⚙️ untuk mengisi API Key.');

  const stats = fs.statSync(audioPath);
  const sizeMB = stats.size / (1024 * 1024);

  // If under 6MB, send directly (super fast, prevents ECONNRESET)
  if (sizeMB <= 6) {
    const data = await callWhisperApi(audioPath, apiKey, provider);
    return {
      text: data.text || '',
      segments: data.segments || [],
      words: data.words || [],
    };
  }

  console.log(`[AI] Audio file (${sizeMB.toFixed(2)} MB) is large. Chunking to 8-minute segments...`);
  const tmpDir = path.dirname(audioPath);
  const chunkTemplate = path.join(tmpDir, 'chunk_%03d.mp3');
  const segmentDurationSec = 480; // 8 minutes per chunk (~1.5 MB each)

  const splitCmd = `"${ffmpegPath}" -y -i "${audioPath}" -f segment -segment_time ${segmentDurationSec} -c:a libmp3lame -b:a 24k -ar 16000 -ac 1 "${chunkTemplate}"`;
  await runCmd(splitCmd);

  const chunkFiles = fs.readdirSync(tmpDir).filter((f: string) => f.startsWith('chunk_') && f.endsWith('.mp3')).sort();
  console.log(`[AI] Splitted into ${chunkFiles.length} chunks. Transcribing chunks sequentially...`);

  let fullText = '';
  const allSegments: TranscriptSegment[] = [];
  const allWords: TranscriptWord[] = [];

  for (let i = 0; i < chunkFiles.length; i++) {
    const chunkFile = path.join(tmpDir, chunkFiles[i]);
    const offsetSec = i * segmentDurationSec;
    console.log(`[AI] Transcribing chunk ${i + 1}/${chunkFiles.length} (Time offset: ${offsetSec}s)...`);

    const chunkData = await callWhisperApi(chunkFile, apiKey, provider);
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
    if (fs.existsSync(chunkFile)) fs.unlinkSync(chunkFile);
  }

  return { text: fullText, segments: allSegments, words: allWords };
}
