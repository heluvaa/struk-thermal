# Struk Thermal — Generator Struk Toko Offline

Generator struk thermal untuk toko: isi data toko + transaksi, lihat pratinjau, unduh PNG.
Berjalan **tanpa server, tanpa akun, tanpa build step** — folder statis, bisa dibuka offline.

## Cara pakai

```bash
# opsi 1: langsung
buka index.html di browser (double click)

# opsi 2: server lokal (perlu untuk uji service worker / PWA offline)
cd struk-thermal && python3 -m http.server 8789
# lalu buka http://127.0.0.1:8789/index.html
```

Tombol utama:
- **Acak struk baru** — isi seluruh transaksi dengan data acak (produk tetap Fanta 250ml @ Rp 6.400).
- **Unduh PNG** — simpan hasil struk sebagai gambar, siap dikirim/diarsipkan.
- **Salin teks struk** — versi teks berkolom rapi untuk WhatsApp/chat.
- **Simpan ke riwayat** — simpan struk terakhir di perangkat (localStorage, maks 20).
- **Simpan profil toko** — simpan data toko supaya tidak diketik ulang.

## Isi yang diacak vs tetap

| Bagian | Perilaku |
| :--- | :--- |
| Produk | **Tetap**: `FANTA 250ML`, Rp 6.400. Qty acak 1–3. |
| Nama toko | Tetap `PT. SINAR RITEL NUSANTARA` (bisa diganti di form) |
| NPWP | Acak tiap struk |
| Kode transaksi | Acak, pola `DD,MM,YY-HH:MM/a,b,c/TxxD nnnnnn/KASIR/0n` |
| Tanggal & waktu | Acak 0–21 hari ke belakang, jam 07:00–21:59 |
| Kasir | Acak dari 10 nama |
| Nomor & alamat pelanggan | Acak (kode area + RT/RW + kecamatan + kode pos) |
| Uang diterima | Dibulatkan ke atas kelipatan Rp 5.000 (jadi kembaliannya masuk akal) |
| PPN | 11%, inklusif — DPP & PPN diturunkan dari total |

## Arsitektur

```
index.html          struktur + form
styles.css          tema terang/gelap, responsif
app.js              wiring form <-> engine, riwayat, profil, unduh
manifest.json       metadata PWA
sw.js               service worker: shell offline-first
receipt/
  layout.js         engine layout murni — (input, measure) -> {ops, totals}
  draw.js           ops -> canvas 2D (browser / @napi-rs/canvas)
  text.js           struk versi teks berkolom
  gen.js            generator data acak
tools/
  render.cjs        smoke test render PNG + overlay ASCII + assert matematika
  check.cjs         harness verifikasi (statis + jsdom boot)
  contrast.cjs      audit kontras WCAG
  make-icons.cjs    bikin ikon PWA PNG
```

**Kunci desain:** `receipt/layout.js` tidak menyentuh DOM sama sekali. Pengukuran teks
di-inject sebagai `measure(text, sizePx, bold)` dan family font di-inject lewat
`opts.fontFamily`. Jadi satu kode layout dipakai ulang di browser dan di Node, dan
**yang mengukur = yang menggambar** (kalau dua family berbeda, semua kolom geser).

## Verifikasi

```bash
cd struk-thermal
node tools/render.cjs 3                                  # render PNG + overlay ASCII
NODE_PATH=$HOME/node_modules node tools/check.cjs        # statis + jsdom boot
node tools/contrast.cjs                                  # kontras WCAG
```

Semua harness di atas harus melaporkan 0 error sebelum dianggap selesai.

## Batasan yang perlu diketahui

- **PNG dihasilkan di browser** (canvas). File contoh di `shots/` dibuat oleh Node
  dengan `@napi-rs/canvas` sebagai bukti render, bukan hasil runtime app.
- Data hanya tersimpan di perangkat. Pindah perangkat = data tidak ikut.
- Aplikasi ini untuk pembukuan/latihan. Ini **bukan** struk resmi dari penerbit
  mana pun, dan tidak meniru logo merek siapa pun.
- Service worker hanya aktif di `http(s)://` (atau `localhost`). Dari `file://`
  aplikasi tetap jalan, mode offline-nya saja yang tidak aktif.