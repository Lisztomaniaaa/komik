# komik

KomikVibe — comic reader frontend, data komik real dari MangaDex API.

## Stack

TypeScript murni + Vite (tanpa framework seperti React/Vue). Struktur:

```
index.html         markup halaman (semua view: home, explore, detail, reader, account, dst.)
src/style.css       semua styling (dark theme)
src/types.ts        tipe data (Comic, ChapterEntry, Filters, CommentRow, dll.)
src/mangadex.ts      client API MangaDex — fetch, mapping ke tipe Comic, genre/type/status filter
src/firebase.ts       init Firebase app dari env var (dipakai bareng oleh auth.ts & comments.ts)
src/auth.ts           login/signup/logout via Firebase Authentication (email & password)
src/comments.ts       fetch/post komentar & review ke Firestore — lihat "Setup Firebase" di bawah
src/app.ts           seluruh logic aplikasi (navigasi, filter, reader, login, dsb.)
src/uiChrome.ts       perilaku menu mobile/drawer
src/main.ts           entry point, cuma import file-file di atas
vite.config.ts        proxy /mdx -> api.mangadex.org, proxy /api/img -> gambar MangaDex (lihat di bawah)
api/img.ts            versi Vercel (edge function) dari proxy gambar di atas
firestore.rules        security rules Firestore — tinggal paste ke Firebase Console
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

## Setup Firebase (login & komentar/review)

Login dan komentar/review sekarang beneran live pakai Firebase (bukan demo,
bukan cuma nempel di layar terus ilang pas refresh) — butuh project Firebase
punya sendiri. Ini langkah-langkahnya (gratis, ~5 menit):

1. Buka [console.firebase.google.com](https://console.firebase.google.com)
   -> **Add project** (bisa pakai akun Google, tinggal beberapa klik).
2. Buka **Build -> Authentication** -> **Get started** -> tab **Sign-in
   method** -> aktifkan provider **Email/Password** -> **Save**. Ini yang
   bikin tombol Login di app beneran bisa dipakai (tanpa ini,
   sign up/sign in bakal gagal walau kodenya sudah benar).
3. Di project yang sama, buka **Build -> Firestore Database** -> **Create
   database** -> pilih lokasi -> mulai dalam **production mode**.
4. Masih di Firestore, buka tab **Rules** -> hapus isi default-nya -> copy
   paste isi file `firestore.rules` dari repo ini -> **Publish**. Ini yang
   menentukan siapa boleh baca/tulis komentar (aturan dasarnya sudah benar,
   tidak perlu diubah) — sekarang mewajibkan akun yang sudah login buat
   nge-post komentar.
5. Balik ke **Project settings** (ikon gerigi) -> scroll ke **Your apps**
   -> klik ikon web `</>` -> kasih nama apa saja -> **Register app**.
   Firebase kasih blok kode config — catat 6 nilai di dalamnya
   (`apiKey`, `authDomain`, `projectId`, `storageBucket`,
   `messagingSenderId`, `appId`).
6. Di **Vercel** (dashboard project ini) -> **Settings -> Environment
   Variables**, tambahkan 6 variabel sesuai nama di `.env.example`
   (`VITE_FIREBASE_API_KEY`, dst.) — isinya dari nilai step 5.
7. Redeploy (push apa saja, atau klik "Redeploy" di Vercel).

Kalau mau coba di `npm run dev` juga, copy `.env.example` jadi `.env.local`
dan isi 6 nilai yang sama di situ (file ini gitignored, aman).

**Tanpa 6 env var itu, app tetap jalan normal** — tombol Login nampilin
toast "Login isn't set up yet." dan komentar nampilin "Comments aren't set
up yet." alih-alih error.

**Catatan keamanan**: config Firebase itu memang didesain publik (ikut ke
bundle JS, siapa saja bisa lihat) — yang benar-benar membatasi apa yang
boleh dilakukan adalah **Firebase Authentication** (siapa yang bisa masuk)
dan **Firestore Rules** di `firestore.rules` (siapa yang boleh baca/tulis
data begitu masuk). Rule saat ini: siapa saja boleh baca komentar, tapi
nge-post wajib login (`request.auth != null`) dan `uid` di data harus
cocok sama akun yang login (`request.auth.uid`) — jadi orang tidak bisa
nge-post ngatasnamakan akun lain. Validasi dasar tetap jalan (nama 1-60
karakter, rating 1-5, teks maks 2000 karakter). Belum ada yang boleh
edit/hapus komentar punya siapapun, termasuk punya sendiri.

**Kenapa bukan Supabase**: awalnya dicoba Supabase, tapi koneksi MCP-nya
putus di tengah setup dan tidak nyambung lagi — Firebase dipilih sebagai
gantinya. Desain query komentarnya sengaja menghindari kombinasi
filter+`orderBy` (itu butuh composite index manual di Firestore, sudah
dicek langsung ke dokumentasinya) — pengurutan komentar dilakukan di sisi
JS, bukan di query, supaya nol langkah index manual di Firebase Console.

## Catatan lain

- Chapter cuma dari `translatedLanguage=id`, fallback ke `en` kalau komiknya
  belum ada versi Indonesia.
- Login sudah live lewat Firebase Authentication (email & password, lihat
  "Setup Firebase" di atas). Follow dan reading-progress masih 100% lokal
  (localStorage per browser) — belum ada backend buat itu. Komentar/review
  sudah live lewat Firebase; data komik sudah live lewat MangaDex.
- Progress baca (`panpan-progress` di localStorage) dipakai buat mengisi
  section "Continue reading" di homepage dan tab History di Account.
