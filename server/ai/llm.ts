import type { ChatMessage } from './types';

// ── Robust JSON-array extraction from LLM output ───────────────────
export function parseJsonArray(rawContent: string): any[] {
  const cleaned = String(rawContent || '').replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fall through to bracket-match */ }
  const match = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (match) return JSON.parse(match[0]);
  throw new Error('Gagal memproses rekomendasi momen viral dari AI.');
}

export function parseJsonObject(rawContent: string): any {
  try {
    const arr = parseJsonArray(rawContent);
    const obj = Array.isArray(arr) ? arr[0] : arr;
    if (obj && typeof obj === 'object') return obj;
  } catch { /* try bare object */ }
  const m = String(rawContent || '').match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error('Gagal memproses momen dari AI.');
}

// ── Dynamically discover active Groq models ──────────────────────────
export async function getActiveGroqModels(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (res.ok) {
      const data: any = await res.json();
      const modelIds: string[] = ((data.data || []) as any[]).map((m) => String(m.id));
      console.log('[AI] Active Groq models found:', modelIds.length);
      return modelIds;
    }
  } catch (err) {
    console.warn('[AI] Could not fetch models list from Groq:', (err as Error).message);
  }
  return [];
}

// ── Single chat-completion call with model fallback ────────────────
export async function callChatWithFallback(endpoint: string, headers: Record<string, string>, candidateModels: string[], messages: ChatMessage[], temperature: number, label: string): Promise<string> {
  let lastError: unknown = null;
  for (const model of candidateModels) {
    try {
      console.log(`[AI] ${label} with (${model})...`);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages, temperature }),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[AI] Model ${model} returned ${res.status}: ${String(errText).slice(0, 200)}`);
        lastError = new Error(`AI LLM error (${res.status}): ${String(errText).slice(0, 300)}`);
        continue;
      }
      const jsonRes: any = await res.json();
      const content = jsonRes.choices?.[0]?.message?.content?.trim();
      if (content) {
        console.log(`[AI] ✅ ${label} success with ${model}!`);
        return content;
      }
    } catch (err) {
      lastError = err;
    }
  }
  throw (lastError as Error) || new Error('Gagal menghubungi model AI LLM.');
}

// ── Shared Groq/OpenAI model discovery ─────────────────────────────
export async function getCandidateModels(apiKey: string, provider = 'groq'): Promise<{ endpoint: string; headers: Record<string, string>; candidateModels: string[] }> {
  const endpoint = provider === 'openai'
    ? 'https://api.openai.com/v1/chat/completions'
    : 'https://api.groq.com/openai/v1/chat/completions';
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
  let candidateModels: string[] = [];
  if (provider === 'openai') {
    candidateModels = ['gpt-4o-mini', 'gpt-4o'];
  } else {
    const activeModels = await getActiveGroqModels(apiKey);
    const preferredPriority = [
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'groq/compound',
      'groq/compound-mini',
      'qwen/qwen3.8-27b',
      'qwen/qwen3.6-27b',
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
    ];
    for (const p of preferredPriority) {
      if (activeModels.includes(p)) candidateModels.push(p);
    }
    activeModels.forEach((m) => {
      if (!candidateModels.includes(m) && !m.includes('whisper') && !m.includes('guard')) {
        candidateModels.push(m);
      }
    });
    if (candidateModels.length === 0) {
      candidateModels = ['openai/gpt-oss-120b', 'groq/compound', 'qwen/qwen3.8-27b'];
    }
  }
  return { endpoint, headers, candidateModels };
}
