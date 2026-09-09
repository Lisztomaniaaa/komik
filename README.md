# komik

KomikVibe — comic reader frontend, data komik dari [Sansekai API](https://api.sansekai.my.id).

## Stack

TypeScript murni + Vite (tanpa framework seperti React/Vue). Struktur:

```
index.html         markup halaman (semua view: home, explore, detail, reader, account, dst.)
src/style.css       semua styling (dark theme)
src/types.ts        tipe data (Comic, ChapterEntry, Filters, CommentRow, dll.)
src/sansekai.ts       client API Sansekai — fetch, mapping ke tipe Comic, genre/type filter, caching hemat rate-limit
src/firebase.ts       init Firebase app dari env var (dipakai bareng oleh auth.ts & comments.ts)
src/auth.ts           login/signup/logout via Firebase Authentication (email & password)
src/comments.ts       fetch/post komentar & review ke Firestore — lihat "Setup Firebase" di bawah
src/views.ts          counter view harian di Firestore, buat section "Trending today"
src/ratings.ts        tap-to-rate komik (terpisah dari komentar) — lihat "Rating komik" di bawah
src/app.ts           seluruh logic aplikasi (navigasi, filter, reader, login, dsb.)
src/uiChrome.ts       perilaku menu mobile/drawer
src/main.ts           entry point, cuma import file-file di atas
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

## Sumber data: Sansekai API

Sebelumnya pakai scraper Komikcast, lalu MangaDex API, lalu fork
self-hosted dari [VernSG/Komiku-Rest-Api](https://github.com/VernSG/Komiku-Rest-Api)
— tapi banyak endpoint di deployment self-hosted itu jadi mati/timeout,
sedangkan re-deploy manual bukan solusi yang bisa diandalkan. Sekarang
pindah ke [Sansekai API](https://api.sansekai.my.id) (dokumentasi Swagger
ada di root URL-nya) — API publik yang sudah di-hosting orang lain, bukan
scraper yang di-maintain sendiri lagi.

Sansekai cuma punya 7 endpoint komik: `/komik/recommended`, `/komik/latest`,
`/komik/search`, `/komik/popular`, `/komik/detail`, `/komik/chapterlist`,
`/komik/getimage` — **tidak ada endpoint genre-filter atau status-filter di
sisi server**, dan cuma `/komik/popular` yang benar-benar mendukung
paginasi (100 halaman x 10 item); `/komik/latest`, `/komik/recommended`,
dan `/komik/search` selalu mengembalikan satu batch tetap dan mengabaikan
parameter `page` sepenuhnya (dicek langsung: isi halaman 1 dan halaman 2
identik). Karena itu:

- **Genre & type filtering itu client-side**, dari pool `/komik/popular`
  yang di-download halaman demi halaman dan disaring sendiri di
  `fetchList()` (`src/sansekai.ts`) — sama seperti pendekatan lama ke
  Komiku, tapi sumbernya sekarang `popular`, bukan `pustaka`/`genre/:slug`.
- **Daftar genre di-hardcode** (`CURATED_GENRES` di `src/sansekai.ts`),
  bukan ditarik dari API — Sansekai tidak punya endpoint semacam
  `/genre-all`. Daftarnya disusun dari genre yang benar-benar muncul di
  ratusan judul sampel (lewat `popular`/`latest`/`recommended`); klik genre
  manapun tetap memfilter pool asli by slug, daftar ini cuma menentukan
  chip mana yang ditampilkan.
- **Tidak ada status Ongoing/Completed/Hiatus asli** — beda dari Komiku
  yang punya teks status di halaman scrape, Sansekai cuma kasih
  `latest_chapter_time`. `Comic.status` sekarang heuristik: "Hiatus" kalau
  chapter terakhir naik lebih dari 180 hari lalu, selain itu "Ongoing".
- **Rating & jumlah pembaca sekarang data asli**, bukan `0` seperti Komiku
  dulu — Sansekai punya `user_rate` (skala 0–10) dan `view_count` per
  judul, dipetakan ke `Comic.rating`/`Comic.readers`.
- **"Top trending"** sekarang mengambil 3 halaman pertama `/komik/popular`
  (30 judul, ditarik sekali per sesi) alih-alih gabungan
  `/rekomendasi` + `/komik-populer` seperti dulu.
- **Gambar tidak butuh proxy** — CDN Sansekai (`assets.shngm.id`, di
  belakang Cloudflare) bisa diakses langsung dari `<img>`, beda dari CDN
  Komiku yang butuh `/image-proxy` khusus. `src/sansekai.ts` jadi lebih
  sederhana karena tidak ada lagi fungsi `proxiedImage()`.

### Rate limit 5 request/menit — ini yang paling penting

Tier gratis Sansekai dibatasi **5 request per menit per klien** (kelihatan
dari header `ratelimit-limit: 5;w=60`, di-enforce Cloudflare, tidak
didokumentasikan di Swagger UI-nya). Ini bukan detail kecil — ini yang
menentukan hampir seluruh desain `src/sansekai.ts`:

- Setiap request di-cache selamanya per sesi berdasarkan path-nya persis
  (`getJson()`), jadi request identik yang kebetulan terjadi bersamaan
  (mis. mengetik di search box sambil ada di tab Explore memicu
  `quickSearch` dan `fetchList` dengan query yang sama) otomatis nge-share
  satu network call, bukan dua.
- Halaman `/komik/popular` yang sudah pernah ditarik disimpan permanen per
  nomor halaman (`popularPageCache`) dan dipakai bersama oleh Explore,
  genre browsing, DAN trending — jadi gonta-ganti filter genre yang
  halamannya sudah pernah kelihatan itu gratis, tidak menambah request.
- Akumulasi halaman baru buat mengisi satu halaman hasil filter dibatasi
  cuma 4 halaman BARU per klik (`MAX_NEW_PAGES_PER_CALL`, turun jauh dari
  batas lama 8) — genre yang jarang ketemu bisa menampilkan lebih sedikit
  dari 10 item di halaman pertama, baru terisi penuh setelah beberapa kali
  "next page" mengumpulkan lebih banyak halaman ke buffer.
- Kalau limitnya kena, request gagal dengan pesan error yang jelas
  ("Sansekai API is rate-limited...") — tidak ada retry otomatis, supaya
  tidak makin memperparah limit yang sudah kena.

### API terpisah dari app ini

`src/sansekai.ts` memanggil `VITE_SANSEKAI_API_BASE` (default:
`https://api.sansekai.my.id/api`) — layanan pihak ketiga, bukan bagian dari
project `komik` ini dan tidak di-deploy/di-maintain dari sini. API itu
sudah mengirim header `Access-Control-Allow-Origin: *`, jadi app ini bisa
memanggilnya langsung dari browser tanpa proxy same-origin.

Kalau API itu mati atau ganti bentuk response, sumber data ikut mati/rusak
sampai ada perbaikan di kode ini — tidak ada fallback otomatis ke sumber
lain.

## Setup Firebase (login, komentar/review, trending hari ini)

Login dan komentar/review sekarang beneran live pakai Firebase (bukan demo,
bukan cuma nempel di layar terus ilang pas refresh) — begitu juga counter
view yang mengisi section "Trending today" di homepage (lihat `src/views.ts`
— Sansekai punya `view_count` total per judul tapi tidak ada yang scoped
"hari ini", jadi ini dihitung sendiri dari tiap kali halaman detail komik
dibuka). Semua ini butuh project Firebase
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
   menentukan siapa boleh baca/tulis komentar dan counter view (aturan
   dasarnya sudah benar, tidak perlu diubah) — posting komentar wajib login,
   sedangkan counter view boleh ditulis siapa saja (termasuk yang belum
   login) tapi cuma boleh naik 1 per request, tidak bisa dimanipulasi ke
   angka sembarang. **Kalau sebelumnya udah pernah publish rules lama,
   publish ulang** supaya collection `views` baru ikut ke-cover.
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
karakter, teks maks 2000 karakter). Komentar tidak punya rating bintang
(dulu ada, dihapus karena dianggap ribet) — cuma teks polos. Belum ada
yang boleh edit/hapus komentar punya siapapun, termasuk punya sendiri.

Counter view (`views/<tanggal>/mangas/<slug>`) rule-nya beda: siapa saja
boleh nulis (gak wajib login, karena semua pengunjung ikut dihitung), tapi
tiap write cuma boleh berisi field `count` yang naik tepat 1 dari nilai
sebelumnya (atau `1` untuk dokumen baru) — dicoba langsung lewat emulator
dan percobaan nge-set angka sembarang (`count: 9999`) atau nambah field
lain memang ditolak.

**Kenapa bukan Supabase**: awalnya dicoba Supabase, tapi koneksi MCP-nya
putus di tengah setup dan tidak nyambung lagi — Firebase dipilih sebagai
gantinya. Desain query komentarnya sengaja menghindari kombinasi
filter+`orderBy` (itu butuh composite index manual di Firestore, sudah
dicek langsung ke dokumentasinya) — pengurutan komentar dilakukan di sisi
JS, bukan di query, supaya nol langkah index manual di Firebase Console.

## Rating komik (tap-to-rate)

Sansekai punya `user_rate` sendiri (dipetakan ke `Comic.rating`, dipakai di
card/hasil pencarian), tapi widget "Reader rating" di halaman detail komik
(di bawah deskripsi, di atas daftar chapter) sengaja tetap fitur sendiri —
5 bintang yang bisa langsung ditap, sengaja **terpisah dari komentar** (dulu
komentar sempat punya
rating, sudah dihapus karena "ribet"). Butuh login (redirect ke form login
kalau belum), satu rating per user per komik (nge-tap ulang mengganti
rating lama), disimpan di Firestore lewat `src/ratings.ts`
(`ratings/{mangaId}/users/{uid}`) — rata-rata dan jumlah rating dihitung di
sisi klien dari subcollection itu. Rule-nya ada di `firestore.rules`, jadi
kalau baru update dari versi sebelumnya, **publish ulang rules-nya**
supaya collection `ratings` ikut ke-cover.

## Catatan lain

- Sansekai kasih judul dalam bahasa Inggris tapi deskripsi dalam bahasa
  Indonesia — dipakai apa adanya, tidak ada logic fallback/terjemahan
  bahasa seperti waktu masih pakai MangaDex.
- Login sudah live lewat Firebase Authentication (email & password, lihat
  "Setup Firebase" di atas) — Follow butuh login (redirect otomatis ke form
  login kalau belum masuk), tapi datanya sendiri masih 100% lokal
  (localStorage per browser), begitu juga reading-progress — belum ada
  backend buat itu. Komentar/review sudah live lewat Firebase; data komik
  sudah live lewat Sansekai (lihat "Sumber data" di atas).
- Progress baca (`panpan-progress` di localStorage) dipakai buat mengisi
  section "Continue reading" di homepage dan bagian "Reading history" di
  halaman Library (dibatasi 20 entri terakhir).
- **Library punya halaman sendiri**, terpisah dari Account — dulu itu cuma
  salah satu tab di dalam Account (dengan sidebar Profile/Notifications/
  Settings/Security di sekelilingnya, terasa seperti "pengaturan akun"
  padahal isinya cuma daftar komik). Sekarang Library (judul yang di-follow
  + riwayat baca) berdiri sendiri tanpa sidebar akun sama sekali. Sidebar
  akun sendiri juga tidak lagi menampilkan badge role ("READER") — sudah
  dihapus karena tidak dipakai untuk apa-apa.
- Reader (halaman baca chapter) sekarang benar-benar full-bleed di layar
  sempit (≤900px, tempat sidebar chapter disembunyikan): `.page` dibuat
  selebar viewport (`100vw`) dan dilepas dari padding `.container` situs,
  bukan cuma "100% dari kontainer yang masih ada paddingnya" seperti
  sebelumnya — itu sebabnya dulu masih ada ruang kosong kiri-kanan walau
  `.comicPage` sendiri sudah `width:100%`.
- Tap-to-rate sekarang optimistic: begitu ditekan, bintang 1..N langsung
  menyala di layar tanpa nunggu balasan Firestore — sebelumnya bintang baru
  ke-update setelah `loadRatingSummary` selesai fetch ulang, jadi kalau
  koneksi lambat (atau gagal karena rules Firestore belum di-publish ulang,
  lihat "Rating komik" di atas) keliatannya cuma bintang yang dipencet yang
  bereaksi. Kalau simpan-nya gagal, tampilan dikembalikan sesuai data
  server yang sebenarnya begitu diketahui.
- Jumlah chapter di halaman detail komik dulu bisa salah nampilin "0" kalau
  chapter terbaru itu kebetulan "Chapter 0" (prolog) — nomor chapter
  ke-tertukar sama jumlah chapter. Sudah diperbaiki, sekarang selalu pakai
  jumlah chapter yang sebenarnya.
- Cover pakai `cover_portrait_url` langsung dari Sansekai (fallback ke
  `cover_image_url`), diakses langsung dari CDN-nya tanpa proxy — beda dari
  Komiku dulu yang butuh `/image-proxy` khusus + normalisasi parameter
  `resize` supaya tidak burik di section tertentu (lihat "Sumber data" di
  atas soal kenapa proxy itu sudah tidak ada lagi).
- Daftar genre (home & Explore) sekarang daftar hardcoded
  (`CURATED_GENRES` di `src/sansekai.ts`), bukan ditarik dari API — lihat
  "Sumber data" di atas soal kenapa (Sansekai tidak punya endpoint
  semacam `/genre-all`).
- Bottom navbar (Home/Explore/Library/Account) cuma muncul di layar sempit
  (≤900px) — di desktop navigasinya tetap lewat top bar seperti biasa.
  "Library" dan "Account" adalah dua halaman terpisah, keduanya butuh login.
- Search di top bar disembunyikan di layar ≤620px (kepentok lebar), diganti
  ikon kaca pembesar di sebelah hamburger menu yang membuka kotak
  pencariannya sebagai overlay.
- Rating bintang (tap-to-rate) pakai ikon SVG, bukan karakter Unicode "★" —
  beberapa font emoji di device tertentu render karakter itu dengan warna
  sendiri yang mengabaikan CSS `color`, jadi cuma bintang yang baru dipencet
  yang kelihatan menyala walau class "filled" sudah kepasang benar di semua
  bintang di bawahnya. SVG dengan `fill:currentColor` tidak kena masalah ini.
- Buka detail komik menarik dua endpoint terpisah sekaligus secara paralel
  (`/komik/detail` + `/komik/chapterlist`, lihat `fetchComicWithChapters`
  di `src/sansekai.ts`) — beda dari Komiku dulu yang cuma butuh satu scrape
  buat keduanya. Hasilnya di-cache per komik (`mangaCache`/`chaptersCache`
  di `src/app.ts`) supaya buka ulang komik yang sama atau pindah chapter
  tidak menarik ulang dari network.
- Tombol/navigasi "Back" (komik, reader, FAQ/About/Legal, Explore, Account,
  Library) dulu bisa macet — balik ke halaman sebelumnya lewat back button
  browser kadang tidak sampai ke Home, karena fungsi-fungsi itu selalu
  push history entry baru walau dipanggil DARI event "kembali" itu sendiri,
  jadi malah numpuk entry duplikat dan back-nya seperti tidak berefek.
  Sekarang fungsi-fungsi itu tahu kalau dipanggil dari popstate (tombol
  back/forward) dan tidak push lagi.
