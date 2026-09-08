# Clipper v1.0.0 — Extension Potong & Auto-Upload YouTube Shorts

Extension Chrome (side panel) + server lokal untuk mengubah video YouTube
panjang menjadi klip vertikal 9:16 siap posting — dari deteksi momen viral
dengan AI, rendering potongan, sampai **upload/schedule otomatis ke
YouTube Shorts** lewat sesi login browser sendiri (tanpa API key YouTube,
tanpa OAuth).

## Arsitektur

```
┌─────────────────────┐      ┌──────────────────────┐      ┌─────────────────────┐
│  Extension (MV3)    │      │  Server lokal :3002  │      │  YouTube Studio     │
│  side panel +       │◄────►│  Express + yt-dlp +  │─────►│  studio.youtube.com │
│  content script     │ queue│  FFmpeg + AI         │ file │  (auto-fill & klik  │
└─────────────────────┘      └──────────────────────┘      │   otomatis)         │
                                                           └─────────────────────┘
```

| Komponen | Lokasi | Peran |
|---|---|---|
| Dashboard side panel | `client/` → build ke `extension/dist/` | UI: tempel URL, auto-detect momen viral, atur framing/caption, antre upload |
| Extension Chrome MV3 | `extension/` (`manifest.json`, `content_scripts/yt_studio.js`) | Side panel + otomasi halaman upload YouTube Studio |
| Backend lokal | `server/` (`index.js`, `aiService.js`) | Transkripsi Whisper, deteksi momen viral (Groq/OpenAI), render klip 9:16, antrean upload |

## Fitur

- **AI viral-moment detection** — unduh audio, transkripsi (Whisper via Groq/OpenAI),
  lalu LLM memilih segmen paling viral (durasi 15–90 detik, bisa diatur).
- **Render klip 9:16** — unduh seksi video via yt-dlp, reframe vertikal
  (Smart auto-crop / Blur BG / Crop tengah / Mode Streamer split-screen),
  kualitas 720p atau 1080p.
- **Caption gaya TikTok** — subtitle kata-per-kata hasil transkripsi audio
  potongan yang sama (presisi milidetik), dibakar ke video via FFmpeg.
- **Skor viralitas** — tiap klip dinilai + diberi tips engagement.
- **AI caption sosial** — judul + deskripsi + hashtag otomatis per klip
  (tunggal maupun batch).
- **Auto-upload ke YouTube Studio** — content script otomatis:
  1. Membuka modal upload kalau belum terbuka.
  2. Mengambil file klip dari server lokal dan menyuntikkannya.
  3. Mengisi judul (hook + emoji + #Shorts), deskripsi, hashtag, dan
     audience ("Not Made for Kids").
  4. Mengeklik Next → Next → Next sampai langkah publikasi.
  5. Memilih **Publik** atau **Schedule** (tanggal & jam persis) lalu
     Publish / Schedule.
- **Antrean batch** — banyak klip diantrekan sekaligus, diproses berurutan
  otomatis sampai habis, dengan badge kontrol mengambang (live step,
  counter antrean, pause/resume).
- **Dashboard klip** — daftar, unduh, transkripsi ulang, hapus, dan generate
  ulang caption per klip. Metadata tersimpan di `server/clips.json`.

## Prasyarat

- [Node.js](https://nodejs.org/) v18+
- [Python](https://www.python.org/) 3.x (untuk `server/detect_face.py` —
  deteksi wajah/facecam mode Smart & Streamer)
- Google Chrome / Chromium
- API key **Groq** (gratis) atau **OpenAI** untuk transkripsi + AI

Binary `ffmpeg.exe` + `yt-dlp.exe` **tidak ikut repo** (gitignored).
Download manual (Windows) — dari root repo:

```powershell
npm run fetch:binaries
```

Hasil: `server/ffmpeg.exe` + `server/yt-dlp.exe`.
Paksa download ulang: `npm run fetch:binaries -- -Force`.

Model ML (`server/models/yunet.onnx`, `ferplus_int8.onnx`) auto-download
saat pertama dipakai kalau belum ada.

## Setup (dari nol)

```powershell
# 0. Download binary (sekali saja, Windows)
npm run fetch:binaries

# 1. Install dependency server + client
npm run install:all

# 1b. (opsional) dependency Python untuk face/reframe
py -m pip install -r server/requirements.txt

# 2. Isi API key (salin contoh lalu edit)
copy server\config.json.example server\config.json
# isi "groqApiKey" (atau "openaiApiKey" + "provider": "openai")

# 3. Jalankan server (http://localhost:3002)
npm start

# 4. Build dashboard extension (di terminal lain)
npm run build:ext   # output ke extension/dist/ (gitignored, build lokal)
```

**Pasang extension ke Chrome:**

1. Buka `chrome://extensions`, aktifkan **Developer mode**.
2. Klik **Load unpacked** → pilih folder `extension/`.
3. Buka side panel extension dari toolbar Chrome.

> Server harus jalan (`npm start`) sebelum extension dipakai —
> side panel dan content script berkomunikasi lewat `http://localhost:3002`.
> `extension/dist/` tidak di-commit — tiap clone baru wajib `npm run build:ext`.

## Cara pakai

1. Buka side panel extension, tempel URL YouTube → **Auto-Detect**.
   Tunggu AI selesai (progres live: unduh audio → transkripsi → analisis viral).
2. Pilih salah satu momen viral → atur framing (`smart` / `blur` / `crop` /
   `streamer` / `landscape`), kualitas (`720p` / `1080p`), caption on/off + posisi.
   Jumlah momen bisa dipilih 5–50 (default 10).
3. Klik proses klip, tunggu render selesai (progres live sampai 100%).
4. (Opsional) Generate caption AI untuk judul + deskripsi + hashtag.
5. Klik **Upload ke YouTube** (tunggal atau batch sekaligus) → buka
   `https://studio.youtube.com/channel/UC/videos/upload` di tab Chrome.
6. Content script mengambil alih otomatis: isi metadata → klik wizard →
   publik/schedule. Untuk batch, setelah satu selesai otomatis lanjut ke
   antrean berikutnya sampai habis.

Pengaturan provider & API key juga bisa diubah dari menu **Settings** ⚙️
di dashboard (tanpa edit file manual).

## Mode Turnamen (VOD panjang, mis. MLBB)

Untuk VOD 90–120 menit (link YouTube biasa setelah match selesai):

1. Centang **🏟️ Mode Turnamen** sebelum Auto-Detect → analisis mencakup
   full durasi (s/d 100 momen, lexicon war: savage/maniac/lord/turtle/dll)
   + deteksi **batas antar game** (keyword + jeda sunyi).
2. **Pecah per game**: tiap batas game ada tombol potong → jadi 1 file
   per game. Pakai framing **Landscape 16:9** untuk video reguler,
   atau 9:16 untuk Shorts dari momen yang sama.
3. Momen war individual tetap terdeteksi seperti biasa — render satu per
   satu atau batch sekaligus, lalu schedule upload.

> VOD 2 jam = ±15 chunk Whisper → auto-detect bisa 10–20 menit.
> Potongan game panjang s/d 45 menit didukung (`--download-sections` +
> render langsung, tanpa batas 90 detik).

## Script root

| Perintah | Fungsi |
|---|---|
| `npm run install:all` | Install deps `server/` + `client/` |
| `npm run fetch:binaries` | Download `ffmpeg.exe` + `yt-dlp.exe` ke `server/` |
| `npm start` | Build server TS → `server/dist/` lalu jalankan `:3002` |
| `npm run dev:server` | Server mode watch (tsx, tanpa build) |
| `npm run build:ext` | Build content script TS + side-panel `client/` → `extension/` |
| `npm run build:content` | Build `yt_studio.ts` → `content_scripts/yt_studio.js` saja |
| `npm run typecheck` | Typecheck server + client |
| `npm run dev:client` | Dev UI side-panel (Vite) |

> Seluruh kode JavaScript sudah TypeScript: `server/*.ts` (strict,
> compile ke `server/dist/`), `client/src/*.tsx`, dan
> `extension/content_scripts/yt_studio.ts` (compile ke `.js` yang dimuat
> manifest). File hasil compile di-gitignore — tiap clone baru wajib
> `npm run build:ext`.

## Endpoint server (ringkas)

| Method | Endpoint | Fungsi |
|---|---|---|
| GET/POST | `/api/settings` | Provider & API key AI |
| POST (SSE) | `/api/auto-detect` | Deteksi momen viral dari URL YouTube (+`matchMode`, `detectGames`, `maxMoments` s/d 100) |
| POST (SSE) | `/api/clip` | Render klip 9:16 (`smart`/`blur`/`crop`/`streamer`) atau 16:9 (`landscape`) |
| GET/DELETE | `/api/clips`, `/api/clips/:id` | Daftar, unduh, hapus klip |
| POST | `/api/clips/:id/transcribe` | Transkripsi ulang klip |
| GET/POST/DELETE | `/api/pending-upload` | Antrean upload (dibaca content script) |
| POST | `/api/pending-upload/advance` | Lanjut ke antrean berikutnya |
| POST | `/api/generate-caption`, `/api/generate-captions-batch` | Caption AI satuan & batch |
| GET | `/api/upload-urls/:id` | URL upload per platform + URL unduh klip |

## Catatan & keterbatasan

- **Windows only** — path binary (`ffmpeg.exe`, `yt-dlp.exe`) dan perintah
  `python` berasumsi environment Windows.
- Auto-upload memakai DOM YouTube Studio yang bisa berubah sewaktu-waktu;
  kalau YouTube mengubah struktur halamannya, selector di
  `extension/content_scripts/yt_studio.js` perlu disesuaikan.
- `server/config.json`, `server/clips/` dan `server/clips.json` adalah data
  lokal (jangan di-commit).
- Hanya gunakan untuk konten yang kamu miliki atau berhak dipakai ulang;
  mengunduh atau memposting ulang video pihak ketiga dapat melanggar
  Ketentuan Layanan YouTube dan hukum hak cipta. Kamu bertanggung jawab
  atas yang diproses dan diposting. Tidak ada garansi apa pun.

Tidak berafiliasi dengan, didukung oleh, atau disponsori oleh YouTube,
Google, OpenAI, atau Groq.
