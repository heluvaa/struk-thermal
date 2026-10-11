# Struk Thermal — Design Spec

Tanggal: 2026-10-12
Status: diimplementasikan & terverifikasi

## 1. Tujuan

Toko kecil butuh struk untuk pembukuan. Printer thermal tidak selalu ada di depan meja.
Tujuan: **satu halaman web statis yang menghasilkan gambar struk thermal** dari input manual,
jalan offline, dan bisa dipasang ke home screen ponsel.

Bukan tujuan: integrasi printer, sinkronisasi server, multi-user, database.

## 2. Keputusan yang mengikat

Diambil dari wawancara awal (disimpan apa adanya):

- Cara pakai: **bisa di-host** (URL publik), tapi tetap jalan offline.
- Input: **form manual** satu per satu, bukan import batch.
- Output: **PNG** (siap dibagikan/simpan sebagai bukti).
- Selanjutnya user memberi referensi struk minimarket: format **diikuti** (blok toko + NPWP,
  blok pelanggan, baris kode transaksi, item `NAMA harga jumlah`, `HARGA JUAL`, `TOTAL/TUNAI/KEMBALI`,
  `PPN : DPP= PPN=`, footer layanan konsumen), produk diganti **Fanta 250ml @ 6.400**,
  sisanya diacak.

## 3. Arsitektur

Tiga lapis, sengaja dipisah supaya bisa diuji tanpa browser:

1. **Model + layout murni** (`receipt/layout.js`)
   - Input: objek struk + fungsi `measure`.
   - Output: daftar operasi gambar (`text`, `hr`, `rs`) + hasil hitung (`totals`) + statistik.
   - Tidak ada DOM, tidak ada `Date.now()`, tidak ada `Intl`. Uang diformat manual
     (pemisah ribuan `,`, desimal `,`) supaya hasil identik di semua lingkungan.

2. **Renderer** (`receipt/draw.js`)
   - Menerima daftar operasi, menggambar ke canvas 2D.
   - Family font **diambil dari layout** (`layout.fontFamily`), bukan hard-code — ini yang
     menjamin teks yang diukur sama dengan yang digambar.

3. **Antarmuka** (`app.js` + `index.html` + `styles.css`)
   - Form ↔ model, pratinjau langsung, unduh PNG, riwayat, profil toko, tema.
   - Riwayat & profil: localStorage. Tidak ada jaringan.

## 4. Aturan angka (satu sumber kebenaran)

- `computeTotals()` di `layout.js` adalah **satu-satunya** tempat total dihitung.
  Layar, PNG, dan teks memakai hasil yang sama — tidak mungkin beda.
- PPN **inklusif** (seperti struk minimarket): total sudah memuat PPN, lalu
  `DPP = round(total / 1.11)` dan `PPN = total - DPP`. Dijamin `DPP + PPN == total`.
- Diskon diterapkan sebelum pajak; dijepit di rentang `0..gross`.
- Kembalian `= max(0, tunai - total)`; kalau tunai kurang, struk mencetak `KURANG` + status.

## 5. Layout & tipografi

- Kertas: 58 mm (384 px, 32 kolom) dan 80 mm (576 px, 48 kolom).
- Font: monospace (DejaVu Sans Mono bila tersedia; `monospace` sebagai fallback).
  Monospace wajib: blok struk thermal bergantung pada kolom yang sejajar.
- Header adaptif: kotak tanda toko berbagi baris dengan nama toko **hanya kalau nama muat**;
  kalau tidak, kotak naik ke barisnya sendiri dan nama memakai lebar penuh.
- Teks yang tetap harus satu baris (`nowrap`): nama toko, blok alamat, footer. Kalau tidak muat,
  footer dikecilkan dulu (maks 9 px); kalau masih tidak muat, dipotong dengan `..` dan dihitung
  sebagai `truncated` — harness gagal kalau ada `truncated`.

## 6. Penanganan error

- Semua angka diformat dari nilai yang sudah dinormalisasi (`Number`, bukan `parseFloat` mentah),
  jadi input kosong/aneh jadi `0`, bukan `NaN` yang tercetak sebagai "NaN".
- `readItems()` membuang baris kosong sehingga item tanpa nama/harga tidak masuk struk.
- Menghapus semua baris item menyisakan satu baris kosong (tidak pernah nol baris).
- localStorage dibungkus `try/catch`: mode privat / kuota penuh tidak boleh mematikan app.
- Service worker gagal registrasi tidak memblokir boot.

## 7. Strategi tes

- `tools/render.cjs` — render N struk acak; assert `DPP+PPN==total`, `total==qty*price`,
  `kembalian==tunai-total`, tidak ada garis terpotong, tidak ada teks keluar kertas,
  tidak ada `undefined` tercetak. Plus **overlay ASCII** dari operasi gambar untuk melihat
  tabrakan teks tanpa melihat gambar.
- `tools/check.cjs` — (a) statis: semua aset yang dirujuk ada di disk, tag heading seimbang,
  semua `#id` yang dipakai `app.js` ada di HTML, kelas CSS yang dipakai ada di stylesheet;
  (b) 60 struk acak lewat engine; (c) **boot nyata di jsdom**: total terisi, DPP+PPN==total di layar,
  tombol acak mengubah struk, tambah/duplikat/hapus item, total ikut input, non-tunai menolkan
  kembalian, jalur PNG menghasilkan gambar, riwayat tersimpan & tampil, form terpulihkan,
  nol error konsol.
- `tools/contrast.cjs` — kontras WCAG tiap pasangan warna dari token di `styles.css`.
  Ambang 4.5:1 untuk teks, 3:1 untuk batas kontrol.
- Verifikasi visual: screenshot headless Chromium (390 px & 1440 px) + probe overflow
  yang mengukur `scrollWidth` vs `innerWidth` di iframe.

## 8. Hasil verifikasi (bukti, bukan klaim)

- `render.cjs`: `ALL_CHECKS_OK`, `truncated: 0`, monospace terkonfirmasi
  (M = i = spasi = 12,04 px @ 20px).
- `check.cjs`: `RESULT: PASS (0 errors, 0 warnings)` — 60 struk acak + 16 pemeriksaan jsdom.
- `contrast.cjs`: `CONTRAST_OK`, 15 pasangan, 0 di bawah ambang.
- Probe overflow: 360/390/1024 px → `scrollWidth == innerWidth`, tanpa scroll horizontal.
- Screenshot mobile & desktop: struk terbaca, ringkasan terisi, tanpa tumpang tindih.

## 9. Cacat yang ditemukan saat verifikasi (dan diperbaiki)

1. **Font diukur ≠ font digambar.** Node mengukur dengan `DejaVu Sans Mono` sementara
   `draw.js` menggambar dengan `monospace` → kolom bergeser. Diperbaiki: family di-inject
   lewat `layout.fontFamily`, dan `draw.js` memakainya.
2. **Glyph kosong di render node.** Font belum terdaftar di `@napi-rs/canvas`, jadi
   `GlobalFonts` me-resolve semua nama ke satu face default. Diperbaiki:
   `GlobalFonts.registerFromPath(...)` untuk DejaVu Sans Mono (regular + bold).
3. **Header ter-wrap mid-kata.** Nama legal panjang + kotak logo memakan sepertiga lebar;
   blok alamat ikut terpotong padahal tidak perlu. Diperbaiki: header adaptif (poin 5).
4. **Footer terpotong.** `LAYANAN KONSUMEN ...` ter-wrap di 58 mm. Diperbaiki: nowrap +
   perkecil font sampai muat.
5. **Paint pertama kosong.** `boot()` tidak memanggil `render()`, jadi canvas tetap placeholder
   dan ringkasan tetap `0` sampai user mengetik. Ditemukan oleh pemeriksaan jsdom "total on boot".
   Diperbaiki: panggil `render()` di akhir boot.
6. **Scroll horizontal di ponsel.** Grid child tidak menyusut di bawah lebar intrinsik `<input>`
   (~177 px) → halaman butuh 404 px di viewport 360 px. Diperbaiki: `min-width: 0` untuk
   child grid/flex/rekaman.
7. **Target sentuh 38 px.** Tombol varian kecil di bawah 44 px. Diperbaiki: `.btn-sm` = 44 px.
8. **Paint pertama belum lunas.** Boot tidak mengisi uang diterima → struk pertama tampil
   `TUNAI: 0 / KURANG: …`. Diperbaiki: boot mengisi uang tunai seperti jalur acak.

## 10. Hal yang sengaja TIDAK dibuat (YAGNI)

- Import batch CSV/Excel — user memilih form manual.
- PDF & mode cetak langsung ke printer — user memilih PNG.
- Backend, akun, sinkronisasi — tidak diperlukan untuk satu perangkat.
- Barcode/QR — tidak diminta.