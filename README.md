# komik

KomikVibe — comic reader frontend, data komik dari sebuah scraper Komiku self-hosted.

## Stack

TypeScript murni + Vite (tanpa framework seperti React/Vue). Struktur:

```
index.html         markup halaman (semua view: home, explore, detail, reader, account, dst.)
src/style.css       semua styling (dark theme)
src/types.ts        tipe data (Comic, ChapterEntry, Filters, CommentRow, dll.)
src/komiku.ts        client API Komiku — fetch, mapping ke tipe Comic, genre/type filter
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

## Sumber data: Komiku (scraper self-hosted)

Awalnya dicoba scraper Komikcast, lalu MangaDex API, lalu API publik
`komiku-rest-api.vercel.app` (fork dari
[VernSG/Komiku-Rest-Api](https://github.com/VernSG/Komiku-Rest-Api)) — instance
publiknya sendiri sudah mati (402 Payment Required dari Vercel milik pembuatnya),
jadi kodenya di-fork dan di-deploy ulang sendiri.

**Catatan penting soal legalitas**: Komiku.org adalah situs aggregator
scanlation tanpa lisensi resmi dari penerbit. Ini keputusan sadar pemilik
project — bukan sesuatu yang direkomendasikan secara default. Kalau butuh
sumber data yang benar-benar legal, MangaDex API (yang dipakai project ini
sebelumnya) adalah alternatif resmi dan gratis.

Trade-off teknis dari pindah ke scraper HTML (dibanding API resmi seperti
MangaDex):
- **Gampang rusak**: kalau komiku.org ubah struktur HTML-nya, endpoint yang
  bergantung pada CSS selector tertentu (lihat `controllers/*.js` di repo
  scraper) bisa berhenti mengembalikan data tanpa peringatan apapun.
- **Tidak ada rating/jumlah pembaca**: komiku.org tidak punya sistem rating
  publik yang bisa di-scrape, jadi `Comic.rating` selalu `0` — lihat
  `NO_RATING` di `src/komiku.ts`.
- **Filter lebih terbatas**: tidak ada filter status (Ongoing/Completed) atau
  sort-by-rating di level listing (data itu cuma ada di halaman detail per
  komik, bukan di halaman daftar) — Explore cuma punya filter Type + Genre.
- **Paginasi perkiraan**: endpoint Komiku tidak mengembalikan total item
  pasti, cuma sinyal "ada halaman berikutnya atau tidak" — jumlah halaman di
  UI adalah estimasi, bukan angka pasti seperti MangaDex.
- **Filter tipe di level listing itu client-side**: `/pustaka` dan
  `/genre/:slug` tidak punya parameter filter tipe (Manga/Manhwa/Manhua) di
  sisi server, jadi `fetchList()` di `src/komiku.ts` menarik halaman demi
  halaman dan menyaring sendiri sampai terkumpul cukup buat satu halaman
  penuh (dibatasi max 8 kali fetch per klik biar tidak jalan tanpa henti
  kalau filternya jarang ketemu). Hasilnya konsisten (selalu coba penuhi 10
  item per halaman), tapi untuk kombinasi filter yang jarang bisa lebih
  lambat karena beberapa halaman asli ditarik sekaligus.
- **"Trending" (hari ini & sepanjang masa) hasil gabungan, bukan satu
  endpoint**: Komiku tidak punya endpoint dengan cukup item buat
  dipaginasi sendirian (`/rekomendasi` cuma ~9 judul) — "Top trending" itu
  gabungan `/rekomendasi` + tiga bagian `/komik-populer` (dedup by slug),
  sedangkan "Trending today" itu titel yang paling banyak dibuka hari ini
  (lihat `src/views.ts`) digabung sisa slot dari `/terbaru` kalau belum
  cukup. Keduanya ditarik sekali per sesi lalu dipaginasi di sisi klien.
- Tipe komik (Manga/Manhwa/Manhua) dan genre didapat langsung dari field yang
  di-scrape, tidak perlu heuristik/tabel mapping seperti waktu masih pakai
  MangaDex.

### API scraper terpisah dari app ini

`src/komiku.ts` memanggil `VITE_KOMIKU_API_BASE` (default:
`https://komiku-rest-api-selfhost.vercel.app`) — sebuah deployment Vercel
**terpisah**, bukan bagian dari project `komik` ini. API itu sudah mengirim
header `Access-Control-Allow-Origin: *` dan punya `/image-proxy` sendiri
untuk gambar, jadi app ini tidak butuh proxy `/mdx` atau `/api/img` seperti
waktu masih pakai MangaDex.

Kalau API itu mati (limit Vercel gratis gampang kena kalau traffic naik —
persis ini yang bikin instance publik aslinya mati), sumber data ikut mati
sampai di-deploy ulang secara manual — tidak ada fallback otomatis.

## Setup Firebase (login, komentar/review, trending hari ini)

Login dan komentar/review sekarang beneran live pakai Firebase (bukan demo,
bukan cuma nempel di layar terus ilang pas refresh) — begitu juga counter
view yang mengisi section "Trending today" di homepage (lihat `src/views.ts`
— Komiku sendiri tidak punya data view/read, jadi ini dihitung sendiri dari
tiap kali halaman detail komik dibuka). Semua ini butuh project Firebase
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

Komiku sendiri tidak punya data rating (lihat `NO_RATING` di `src/komiku.ts`),
jadi widget "Reader rating" di halaman detail komik (di bawah deskripsi, di
atas daftar chapter) adalah fitur sendiri — 5 bintang yang bisa langsung
ditap, sengaja **terpisah dari komentar** (dulu komentar sempat punya
rating, sudah dihapus karena "ribet"). Butuh login (redirect ke form login
kalau belum), satu rating per user per komik (nge-tap ulang mengganti
rating lama), disimpan di Firestore lewat `src/ratings.ts`
(`ratings/{mangaId}/users/{uid}`) — rata-rata dan jumlah rating dihitung di
sisi klien dari subcollection itu. Rule-nya ada di `firestore.rules`, jadi
kalau baru update dari versi sebelumnya, **publish ulang rules-nya**
supaya collection `ratings` ikut ke-cover.

## Catatan lain

- Komiku.org sudah bahasa Indonesia dari sananya, jadi tidak ada logic
  fallback bahasa seperti waktu masih pakai MangaDex.
- Login sudah live lewat Firebase Authentication (email & password, lihat
  "Setup Firebase" di atas) — Follow butuh login (redirect otomatis ke form
  login kalau belum masuk), tapi datanya sendiri masih 100% lokal
  (localStorage per browser), begitu juga reading-progress — belum ada
  backend buat itu. Komentar/review sudah live lewat Firebase; data komik
  sudah live lewat Komiku (lihat "Sumber data" di atas).
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
- Reader (halaman baca chapter) sekarang benar-benar full-width, tidak ada
  lagi ruang kosong di kiri-kanan gambar komik.
- Jumlah chapter di halaman detail komik dulu bisa salah nampilin "0" kalau
  chapter terbaru itu kebetulan "Chapter 0" (prolog) — nomor chapter
  ke-tertukar sama jumlah chapter. Sudah diperbaiki, sekarang selalu pakai
  jumlah chapter yang sebenarnya.
- Fetch listing yang butuh akumulasi banyak halaman (lihat "Filter tipe di
  level listing itu client-side" di atas) sekarang narik beberapa halaman
  sekaligus secara paralel (4 per giliran), bukan satu-satu — mempercepat
  filter yang jarang cocok tanpa menambah jumlah request-nya.
- Daftar genre (home & Explore) ditarik langsung dari endpoint `/genre-all`
  Komiku (~100 tag), bukan daftar hardcoded — lihat `EXCLUDED_GENRE_SLUGS`
  di `src/komiku.ts` untuk tag yang sengaja di-skip (konten eksplisit/dewasa
  dan beberapa tag rusak/duplikat hasil scrape). Karena banyak, cuma 18
  yang tampil duluan dengan tombol "Show more" buat lihat sisanya.
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
- Buka detail komik dan buka chapter dari situ dulu tarik `/detail-komik/<slug>`
  dua kali terpisah (satu buat info komik, satu lagi buat daftar chapter) —
  padahal itu endpoint yang sama persis. Sekarang cuma satu kali fetch buat
  keduanya (`fetchComicWithChapters` di `src/komiku.ts`), jadi buka komik
  jadi dua kali lebih ringan di endpoint yang paling sering dipanggil.
- Tombol/navigasi "Back" (komik, reader, FAQ/About/Legal, Explore, Account,
  Library) dulu bisa macet — balik ke halaman sebelumnya lewat back button
  browser kadang tidak sampai ke Home, karena fungsi-fungsi itu selalu
  push history entry baru walau dipanggil DARI event "kembali" itu sendiri,
  jadi malah numpuk entry duplikat dan back-nya seperti tidak berefek.
  Sekarang fungsi-fungsi itu tahu kalau dipanggil dari popstate (tombol
  back/forward) dan tidak push lagi.
