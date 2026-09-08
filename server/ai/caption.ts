import { getCandidateModels } from './llm';

export interface SocialCaption {
  title: string;
  description: string;
  hashtags: string[];
  fullCaption: string;
}

// ── Generate AI Social Caption, Title, & Hashtags ─────────────────────
export async function generateSocialCaption(clipTitle: string, transcriptText: string, platform = 'youtube', apiKey?: string, provider = 'groq', channelName = ''): Promise<SocialCaption> {
  if (!apiKey) throw new Error('API Key belum diisi. Buka menu Settings ⚙️.');

  const platformName = platform === 'tiktok' ? 'TikTok' : platform === 'instagram' ? 'Instagram Reels' : 'YouTube Shorts';
  const tagRule = platform === 'youtube' ? 'Wajib sertakan #Shorts di akhir judul dan di daftar hashtag.' : 'Gunakan hashtag viral TikTok/Reels.';

  let channelTag = '';
  if (channelName) {
    const cleanTag = channelName.trim().replace(/\s+/g, '').replace(/[^a-zA-Z0-9_]/g, '');
    if (cleanTag) channelTag = `#${cleanTag}`;
  }

  const prompt = `Kamu adalah pakar social media marketing & viral content creator spesialis ${platformName}.
Tugasmu adalah menganalisis transkrip percakapan klip video berikut, lalu membuat Judul Hook Viral, Deskripsi Kontekstual yang menceritakan isi video, serta Hashtag Relevan termasuk nama channel.

Nama Channel / Kreator: ${channelName || '(Tidak spesifik)'}
Judul Klip Saat Ini: "${clipTitle || 'Video Pendek'}"
Transkrip Percakapan Klip:
"""
${(transcriptText || '').slice(0, 2500) || '(Tidak ada transkrip, buat sinopsis berdasarkan judul klip)'}
"""

ATURAN PEMBUATAN:
1. "title":
   - Buat judul baru yang SANGAT MENARIK, PENUH RASA PENASARAN (curiosity hook), dramatis, atau lucu sesuai kejadian di video.
   - Sertakan emoji relevan (😱, 🔥, 🤣, 💀, 🤯, dsb).
   - Maksimal 85 karakter. ${tagRule}

2. "description":
   - JANGAN gunakan template kaku atau kalimat kosong basa-basi!
   - Jelaskan DENGAN MENARIK APA YANG SEBENARNYA TERJADI di video ini berdasarkan percakapan/aksi dalam transkrip (sinopsis cerita momen ini).
   - Buat penonton penasaran dan ingin menonton sampai tuntas.
   - Tambahkan pertanyaan atau ajakan interaksi yang memancing penonton berkomentar.
   - Tambahkan kalimat penutup ajakan like dan subscribe ${channelName ? `ke channel ${channelName}` : 'ke channel ini'}.

3. "hashtags":
   - Array string hashtag (diawali tanda #).
   - WAJIB masukkan hashtag nama channel kreator: ${channelTag ? `"${channelTag}"` : 'nama channel kreator'}.
   - Masukkan 2-3 hashtag topik/genre spesifik dari isi video (contoh: #Gaming, #Horor, #Lucu, #Reaction, #MomenLucu, dsb).
   - Masukkan hashtag trending platform: ${platform === 'youtube' ? '["#Shorts", "#YouTubeShorts", "#Viral", "#FYP", "#Trending"]' : '["#Viral", "#FYP", "#Trending"]'}.
   - Total 6 sampai 9 hashtag.

4. Bahasa: Gunakan Bahasa Indonesia yang luwes, santai, dan sangat memikat penonton media sosial.

Output HANYA format JSON valid tanpa markdown backtick:
{
  "title": "...",
  "description": "...",
  "hashtags": [${channelTag ? `"${channelTag}", ` : ''}"#Shorts", "#FYP", "..."]
}`;

  const { endpoint, headers, candidateModels } = await getCandidateModels(apiKey, provider);

  let rawContent: string | null = null;
  let lastErr: unknown = null;

  for (const model of candidateModels) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
        }),
      });
      if (!res.ok) {
        lastErr = new Error(`LLM error (${res.status}): ${await res.text()}`);
        continue;
      }
      const data: any = await res.json();
      rawContent = data.choices?.[0]?.message?.content?.trim();
      if (rawContent) break;
    } catch (e) {
      lastErr = e;
    }
  }

  if (!rawContent) throw (lastErr as Error) || new Error('Gagal menghubungi AI untuk membuat caption.');

  const cleaned = rawContent.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed: any = JSON.parse(cleaned);
    const tags = Array.isArray(parsed.hashtags) ? parsed.hashtags : ['#Shorts', '#FYP', '#Viral'];
    const formattedTags = tags.map((t: any) => (typeof t === 'string' && t.startsWith('#')) ? t : `#${t}`);
    return {
      title: parsed.title || clipTitle,
      description: parsed.description || '',
      hashtags: formattedTags,
      fullCaption: `${parsed.description || ''}\n\n${formattedTags.join(' ')}`.trim(),
    };
  } catch {
    return {
      title: `${clipTitle} #Shorts`,
      description: `Tonton momen seru ini! Jangan lupa like dan subscribe untuk video seru lainnya!`,
      hashtags: ['#Shorts', '#Viral', '#FYP', '#Trending'],
      fullCaption: `Tonton momen seru ini! Jangan lupa like dan subscribe!\n\n#Shorts #Viral #FYP #Trending`,
    };
  }
}
