# komik

Panpan Comics — prototipe reader komik (frontend saja, semua data dummy/lokal).

## Stack

TypeScript murni + Vite (tanpa framework seperti React/Vue). Struktur:

```
index.html       markup halaman (semua view: home, explore, detail, reader, account, dst.)
src/style.css    semua styling (dark theme)
src/types.ts     tipe data (Comic, Filters, dll.)
src/data.ts      daftar komik dummy, ditipein sebagai Comic[]
src/app.ts       seluruh logic aplikasi (navigasi, filter, reader, login, dsb.)
src/uiChrome.ts  perilaku menu mobile/drawer
src/main.ts      entry point, cuma import ketiga file di atas
```

Markup masih pakai `onclick="fn(...)"` inline seperti aslinya; fungsi-fungsi yang
dipanggil dari situ di-expose ke `window` di akhir `src/app.ts` karena ES module
tidak otomatis bocor ke global scope.

## Cara pakai

```sh
npm install
npm run dev       # dev server dengan hot reload
npm run build     # build production ke dist/
npm run preview   # jalankan hasil build production
```

## Catatan

- Semua data (komik, komentar, login, progress baca) simulasi lokal — tidak ada
  backend/API sungguhan.
- `.detailCover:after` di CSS selalu menampilkan teks "SOLO LEVELING" di cover
  halaman detail (peninggalan dari mockup asli, bukan bug baru).
