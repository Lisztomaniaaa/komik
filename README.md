# komik

KomikVibe — comic reader frontend, data komik dari snapshot katalog terjadwal (dibangun dari dua instance format Sanka + fallback live MangaDex) — lihat "Sumber data" di bawah.

## Stack

TypeScript murni + Vite (tanpa framework seperti React/Vue). Struktur:

```
index.html         markup halaman (semua view: home, explore, detail, reader, account, dst.)
src/style.css       semua styling (dark theme)
src/types.ts        tipe data (Comic, ChapterEntry, Filters, CommentRow, dll.)
src/comicApi.ts       lapisan data komik — snapshot-first, di bawahnya client format Sanka (2 instance) + MangaDex dengan failover otomatis, mapping ke tipe Comic, caching per sesi
scripts/snapshot.mjs  generator snapshot katalog (dijalankan GitHub Actions tiap ~30 menit, hasil ke branch `snapshot`)
public/sw.js          service worker — cache stale-while-revalidate untuk JSON katalog + cache-first untuk gambar
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
npm run dev       # dev server dengan hot reload, http://local## Sumber data: snapshot terjadwal + fallback live

Riwayat sumber data app ini adalah riwayat kematian: scraper
Komikcast, lalu MangaDex, lalu fork self-hosted Komiku (endpoint
mati/timeout), lalu Sansekai (403 mulai Oktober 2026) — empat kali
sumber mati, empat kali app ikut mati. Perbaikan pertama (PR #12)
adalah lapisan provider dengan failover otomatis: browser bicara ke
dua instance format Sanka (KomikCast, KomikIndo) + MangaDex, satu
mati = degradasi. Itu menyelesaikan *keandalan*, tapi bukan
*kecepatan*: origin-nya memang lambat (terukur: KomikIndo TTFB
~0,35 dtk; tunnel KomikCast ~1–1,7 dtk dengan spike sampai 14 dtk;
payload sendiri cuma 12–22 KB, jadi murni soal round trip).

Perbaikan kedua (PR #13) mencoba edge proxy Vercel di depan instance
Sanka — dan gagal secara terukur, post-mortem-nya penting: cache CDN
Vercel itu per-region, jadi dengan TTL 60 detik di path panas
(latest/search) dan traffic yang tipis, entry cache di PoP terdekat
hampir selalu sudah basi sebelum sempat dipakai ulang (nyaris 100%
MISS), sementara jalur MISS lewat proxy justru 2,7–3,1 dtk lawan
0,35 dtk direct. Kesimpulan yang jujur: **browser tidak boleh
bergantung pada panggilan live ke API komunitas untuk permukaan
panasnya.** Arsitektur sekarang (PR #14) membalik arah itu — datanya
yang dipindah mendekat, bukan request-nya yang diperantarai:

1. **Snapshot terjadwal (jalur utama).** Workflow GitHub Actions
   `snapshot` menjalankan `scripts/snapshot.mjs` tiap ~30 menit:
   mengambil katalog dari provider di sisi server (KomikIndo utama,
   KomikCast cadangan), menormalkan ke bentuk `Comic`, menulis ulang
   URL cover lewat pipeline gambar (lihat bawah), lalu menerbitkan
   JSON ke branch `snapshot` (satu commit orphan, force-push):
   `data/home.json` (trending + latest + daftar genre),
   `data/genre-<slug>.json` dan `data/type-<type>.json` (halaman
   pertama per filter). App membacanya lewat
   raw.githubusercontent.com (CDN GitHub, CORS `*`, cache 300 dtk).
   Run yang gagal atau hasilnya terlalu tipis **tidak menerbitkan
   apa-apa** — snapshot lama tetap melayani. Sumber mati sekarang
   berarti data basi maksimal ~1 jam, bukan app mati; dan instance
   sumber cuma disentuh ~100 request per run berapapun traffic app.
2. **Service worker** (`public/sw.js`) — stale-while-revalidate
   untuk JSON katalog (snapshot DAN API live), cache-first untuk
   gambar (maks 200 entri, ≤2,5 MB per gambar), navigasi
   network-first, aset build cache-first. Firebase tidak pernah
   disentuh worker. Kunjungan berulang render dari perangkat
   (~0 ms) sementara satu request latar menyegarkan cache.
3. **Rantai provider live (cadangan).** `src/comicApi.ts` tetap
   menyimpan client Sanka (KomikIndo → KomikCast) + MangaDex dengan
   failover + transport terakhir yang berhasil diingat di
   localStorage — untuk yang tidak dicover snapshot: paginasi dalam
   melewati tepi snapshot, filter gabungan genre+type, pencarian,
   dan detail + isi chapter (long tail memang selalu live, di-route
   ke katalog pemilik komiknya lewat id ber-namespace
   `sanka-komikindo:<slug>` / `mangadex:<uuid>`, yang juga jadi kunci
   Firestore untuk komentar/rating/view counter).

Cover tidak lagi di-hotlink mentah dari CDN sumber (terukur
0,6–1,4 dtk per gambar, thumbnail kecil tapi berat): URL cover
ditulis ulang ke **wsrv.nl** (`w=472&output=webp` — resize +
re-encode WebP di CDN beneran; contoh terukur: thumbnail PNG
141–175 KB jadi WebP ~27 KB), dan URL origin asli disimpan sebagai
`coverFallback` yang dipakai UI kalau URL pipeline gagal dimuat.

Catatan format Sanka (semua diverifikasi langsung ke instance live):

- Endpoint: `/latest/:page`, `/detail/:slug`, `/chapter/:slug`,
  `/library`, `/genres`, `/search/:query/:page`. Response dua
  instance identik bentuknya, jadi satu client (dan satu generator)
  melayani keduanya.
- **Filter genre & type server-side** lewat `/library` (`?genre=`,
  `?type=`), **daftar genre dari `/genres`**, **paginasi beneran**
  (`hasNextPage`/`totalPages`), tanpa rate limit 5 request/menit
  seperti Sansekai dulu. "Top trending" dari field `komikPopuler`
  di response `/latest`.
- **Status asli ada di halaman detail** (teks Indonesia: "Berjalan",
  "Tamat"); di list status heuristik dari tanggal chapter terakhir
  (>180 hari = "Hiatus"). **Tanggal chapter string relatif bahasa
  Indonesia** ("3 hari lalu") dikonversi ke timestamp absolut
  perkiraan karena UI me-render `publishAt` pakai `new Date(...)`.
- Slug instance KomikCast terlihat "dobel" untuk sebagian judul —
  bentuk asli dari sumbernya, diterima endpoint apa adanya; slug
  selalu dipakai verbatim.
- MangaDex sengaja terakhir di rantai live: API resminya praktis
  tidak bisa mati, tapi katalog terjemahan Indonesianya tipis
  (terverifikasi 2026-10-14: 95.091 judul, cuma 6.972 berchapter
  Indonesia) — posisi asuransi, bukan katalog utama.

Base URL provider live bisa dioverride lewat env var
(`VITE_SANKA_KOMIKCAST_BASE`, `VITE_SANKA_KOMIKINDO_BASE`,
`VITE_MANGADEX_API_BASE`). URL snapshot adalah konstanta di
`src/comicApi.ts` (`SNAPSHOT_BASE`, menunjuk branch `snapshot` repo
ini). Semua sumber tetap layanan pihak ketiga — yang berubah:
sekarang tidak ada satu pun dari mereka yang berada di jalur kritis
halaman utama.

## Setup Firebase (login, komentar/review, trending hari ini)

Login dan komentar/review sekarang beneran live pakai Firebase (bukan demo,
bukan cuma nempel di layar terus ilang pas refresh) — begitu juga counter
view yang mengisi section "Trending today" di homepage (lihat `src/views.ts`
— provider komik punya view count total per judul tapi tidak ada yang scoped
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

Provider komik punya rating agregat sendiri (dipetakan ke `Comic.rating`, dipakai di
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

- Judul dan deskripsi dipakai apa adanya dari provider yang melayani —
  di provider Sanka judul umumnya bahasa Inggris dan deskripsi bahasa
  Indonesia; di MangaDex, deskripsi bahasa Indonesia dipilih duluan
  kalau ada.
- Login sudah live lewat Firebase Authentication (email & password, lihat
  "Setup Firebase" di atas) — Follow butuh login (redirect otomatis ke form
  login kalau belum masuk), tapi datanya sendiri masih 100% lokal
  (localStorage per browser), begitu juga reading-progress — belum ada
  backend buat itu. Komentar/review sudah live lewat Firebase; data komik
  sudah live lewat snapshot + lapisan provider (lihat "Sumber data" di atas).
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
- Cover diambil dari URL yang dikasih provider tapi ditulis ulang
  lewat wsrv.nl (resize + WebP) dengan URL origin sebagai fallback —
  lihat "Sumber data". (Komiku dulu butuh `/image-proxy` khusus +
  normalisasi parameter `resize` supaya tidak burik di section
  tertentu; wsrv.nl menyelesaikan soal yang sama tanpa proxy sendiri.)
- Daftar genre (home & Explore) sekarang datang dari snapshot
  (`home.json`, asalnya endpoint `/genres` provider Sanka) — lihat
  "Sumber data" di atas. (Era Sansekai dulu hardcoded karena API-nya
  tidak punya endpoint genre sama sekali.)
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
- Buka detail komik cukup satu panggilan ke provider pemilik komik itu
  (lihat `fetchComicWithChapters` di `src/comicApi.ts`) — di format Sanka
  daftar chapter sudah termasuk di response detail; di MangaDex metadata
  dan daftar chapter memang dua panggilan terpisah. Hasilnya di-cache per komik (`mangaCache`/`chaptersCache`
  di `src/app.ts`) supaya buka ulang komik yang sama atau pindah chapter
  tidak menarik ulang dari network.
- Tombol/navigasi "Back" (komik, reader, FAQ/About/Legal, Explore, Account,
  Library) dulu bisa macet — balik ke halaman sebelumnya lewat back button
  browser kadang tidak sampai ke Home, karena fungsi-fungsi itu selalu
  push history entry baru walau dipanggil DARI event "kembali" itu sendiri,
  jadi malah numpuk entry duplikat dan back-nya seperti tidak berefek.
  Sekarang fungsi-fungsi itu tahu kalau dipanggil dari popstate (tombol
  back/forward) dan tidak push lagi.
