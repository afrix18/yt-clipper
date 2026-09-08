# Clipper Side-Panel UI (`client/`)

React + TypeScript + Vite dashboard untuk extension Chrome (side panel).

- Entry: `src/main.tsx` → `src/App.tsx`
- Dev: `npm run dev` (dari `client/` atau `npm run dev:client` dari root)
- Build extension: `npm run build:ext` → output ke `../extension/dist/`
  (folder `extension/dist/` gitignored — wajib build lokal tiap clone baru)
- `vite.config.ts` memakai `base: './'` agar `dist/index.html` bisa diload
  dari `chrome sidePanel` via path relatif.

Lihat `README.md` di root untuk cara setup & pakai lengkap.
