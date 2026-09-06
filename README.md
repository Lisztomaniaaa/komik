# komik

Panpan Comics — comic reader frontend, data komik real dari MangaDex API.

## Stack

TypeScript murni + Vite (tanpa framework seperti React/Vue). Struktur:

```
index.html         markup halaman (semua view: home, explore, detail, reader, account, dst.)
src/style.css       semua styling (dark theme)
src/types.ts        tipe data (Comic, ChapterEntry, Filters, CommentRow, dll.)
src/mangadex.ts      client API MangaDex — fetch, mapping ke tipe Comic, genre/type/status filter
src/comments.ts       client Supabase (REST) buat komentar & review — lihat "Setup Supabase" di bawah
src/app.ts           seluruh logic aplikasi (navigasi, filter, reader, login, dsb.)
src/uiChrome.ts       perilaku menu mobile/drawer
src/main.ts           entry point, cuma import file-file di atas
vite.config.ts        proxy /mdx -> api.mangadex.org, proxy /api/img -> gambar MangaDex (lihat di bawah)
api/img.ts            versi Vercel (edge function) dari proxy gambar di atas
supabase/schema.sql    SQL buat tabel comments — tinggal paste ke Supabase SQL Editor
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

### Kenapa ada proxy gambar juga (`/api/img`)

Gambar cover & halaman komik diambil dari domain lain lagi
(`uploads.mangadex.org`, dan `*.mangadex.network` yang beda-beda tiap
chapter). Sebagian jaringan/ISP memblokir domain-domain ini secara khusus
walau `api.mangadex.org` sendiri bisa diakses — jadi datanya muncul tapi
semua gambar gagal. `api/img.ts` (Vercel edge function) dan middleware dev
di `vite.config.ts` ambil gambarnya di sisi server lalu diteruskan ke
browser, sama seperti `/mdx` tapi untuk gambar. Karena host halaman chapter
berubah-ubah per request, ini butuh function beneran, bukan rewrite statis.

## Setup Supabase (komentar & review)

Komentar dan review sekarang disimpan permanen (bukan cuma nempel di layar
terus ilang pas refresh) — butuh database Supabase punya sendiri. Ini
langkah-langkahnya (gratis, ~5 menit):

1. Bikin akun & project baru di [supabase.com](https://supabase.com) (bisa
   pakai GitHub, tinggal beberapa klik).
2. Buka project itu -> **SQL Editor** -> **New query** -> copy-paste isi
   file `supabase/schema.sql` dari repo ini -> klik **Run**. Ini bikin
   tabel `comments`-nya, sudah termasuk aturan keamanan dasarnya.
3. Buka **Project Settings -> API** -> catat dua nilai ini:
   - **Project URL** (`https://xxxxx.supabase.co`)
   - **anon public key** (string panjang di bagian "Project API keys")
4. Di **Vercel** (dashboard project ini) -> **Settings -> Environment
   Variables**, tambahkan dua variabel:
   - `VITE_SUPABASE_URL` = Project URL tadi
   - `VITE_SUPABASE_ANON_KEY` = anon public key tadi
5. Redeploy (push apa saja, atau klik "Redeploy" di Vercel).

Kalau mau coba di `npm run dev` juga, copy `.env.example` jadi `.env.local`
dan isi dua nilai yang sama di situ (file ini gitignored, aman).

**Tanpa dua env var itu, app tetap jalan normal** — cuma bagian komentar
yang nampilin "Comments aren't set up yet." alih-alih error.

**Catatan keamanan**: `anon key` itu memang didesain publik (ikut ke bundle
JS, siapa saja bisa lihat) — yang benar-benar membatasi apa yang boleh
dilakukan adalah *Row Level Security* policy di `supabase/schema.sql` (saat
ini: siapa saja boleh baca & post komentar, tidak ada yang boleh edit/hapus
punya orang lain). Karena belum ada login asli, tidak ada proteksi spam
selain itu — begitu login sungguhan ada, policy insert bisa diperketat pakai
`auth.uid()`.

## Catatan lain

- Chapter cuma dari `translatedLanguage=id`, fallback ke `en` kalau komiknya
  belum ada versi Indonesia.
- Login, follow, dan reading-progress masih 100% lokal (localStorage per
  browser) — belum ada backend buat itu. Komentar/review sudah live lewat
  Supabase (lihat di atas); data komik sudah live lewat MangaDex.
- Progress baca (`panpan-progress` di localStorage) dipakai buat mengisi
  section "Continue reading" di homepage dan tab History di Account.
