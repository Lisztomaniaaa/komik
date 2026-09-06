# komik

Panpan Comics — comic reader frontend, data komik real dari MangaDex API.

## Stack

TypeScript murni + Vite (tanpa framework seperti React/Vue). Struktur:

```
index.html         markup halaman (semua view: home, explore, detail, reader, account, dst.)
src/style.css       semua styling (dark theme)
src/types.ts        tipe data (Comic, ChapterEntry, Filters, dll.)
src/mangadex.ts      client API MangaDex — fetch, mapping ke tipe Comic, genre/type/status filter
src/app.ts           seluruh logic aplikasi (navigasi, filter, reader, login, dsb.)
src/uiChrome.ts       perilaku menu mobile/drawer
src/main.ts           entry point, cuma import ketiga file di atas
vite.config.ts        proxy /mdx -> api.mangadex.org (lihat "Kenapa ada proxy" di bawah)
```

Markup masih pakai `onclick="fn(...)"` inline seperti aslinya; fungsi-fungsi yang
dipanggil dari situ di-expose ke `window` di akhir `src/app.ts` karena ES module
tidak otomatis bocor ke global scope.

## Cara pakai

```sh
npm install
npm run dev       # dev server dengan hot reload, http://localhost:5173
npm run build     # build production ke dist/
npm run preview   # jalankan hasil build production
```

## Sumber data: MangaDex API

Awalnya dicoba scraper komikcast (komik Indo asli), tapi:
- Situsnya sendiri bajakan (risiko hukum untuk dijalankan/di-deploy).
- Dua instance publik scraper yang dicoba (`komikcast-api.vercel.app`,
  `komiku-api.fly.dev`) sudah mati — bukti nyata betapa rapuhnya API unofficial.

Jadi dipindah ke [MangaDex API](https://api.mangadex.org/docs/) — resmi, gratis,
dan sudah diverifikasi jalan. Trade-off yang perlu diketahui:

- Kontennya scanlation komunitas (bukan situs komik Indo asli). Sebagian
  deskripsi ada terjemahan Bahasa Indonesia, sebagian fallback ke Inggris.
- MangaDex tidak punya field "type" (Manga/Manhwa/Manhua/Webtoon) langsung —
  ini didapat dari heuristik: `originalLanguage` (ja/ko/zh) + tag "Long Strip"
  untuk Webtoon. Lihat `deriveType()` di `src/mangadex.ts`.
- Filter genre di UI (Action/Romance/Fantasy/Comedy/Horror/Adventure/Drama)
  dipetakan ke tag UUID MangaDex secara manual di `GENRE_TAG_IDS`.
- Rating (skala 0-10 MangaDex, ditampilkan /2) dan jumlah pembaca (follows)
  butuh panggilan terpisah ke `/statistics/manga` — dibatch per halaman hasil,
  bukan per-card, supaya tidak N+1 request.

### Kenapa ada proxy (`/mdx` di vite.config.ts)

`api.mangadex.org` tidak mengirim header `Access-Control-Allow-Origin`, jadi
fetch langsung dari browser diblokir CORS (sudah diverifikasi langsung: request
sukses di curl tapi gagal dengan "Failed to fetch" dari dalam browser). Vite's
dev/preview proxy meneruskan `/mdx/*` ke `https://api.mangadex.org/*` supaya
browser menganggapnya same-origin.

**Ini cuma jalan untuk `npm run dev` dan `npm run preview`.** Untuk deploy di
Vercel, `vercel.json` di root sudah berisi rewrite rule yang setara
(`/mdx/:path*` -> `https://api.mangadex.org/:path*`) — otomatis aktif begitu
Vercel build & deploy ulang. Kalau pindah ke hosting lain (Netlify/GitHub
Pages/dst.), perlu rule proxy/redirect yang setara di sana juga; GitHub Pages
khususnya tidak bisa proxy sama sekali (statis murni), jadi butuh proxy
terpisah (misalnya Cloudflare Worker) kalau mau dipakai di situ.

## Catatan lain

- Chapter cuma dari `translatedLanguage=id`, fallback ke `en` kalau komiknya
  belum ada versi Indonesia.
- Login, komentar, follow, dan reading-progress masih 100% lokal (localStorage),
  tidak ada backend — cuma sumber data komik yang sekarang real.
- Progress baca (`panpan-progress` di localStorage) dipakai buat mengisi
  section "Continue reading" di homepage dan tab History di Account.
