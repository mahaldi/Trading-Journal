# My Trading Journey

Jurnal trading personal — React + Vite dengan server file kecil.
Semua data tersimpan sebagai **file biasa** di folder `data/` pada komputer Anda sendiri:
`trades.json` untuk data trade, dan file gambar utuh untuk tiap screenshot.
Dibangun mengikuti dokumen "My Trading Journey · Konsep Desain" (tema Nocturne, desktop-only).

## Menjalankan

```bash
npm install     # sekali saja
npm run dev     # buka http://localhost:5173
```

Satu perintah menjalankan dua proses sekaligus: server file di port `5174` dan antarmuka
di port `5173`. Server harus hidup selama app dipakai — dialah yang membaca dan menulis file.

Perintah lain:

| Perintah | Fungsi |
| --- | --- |
| `npm run build` | Build produksi ke `dist/` |
| `npm start` | Jalankan hasil build + server jadi satu di `localhost:5174` |
| `npm test` | 40 pengujian perhitungan PnL, R:R, parsing pair, dan aturan tag |
| `npm run compress:dry` | Lihat berapa yang bisa dihemat dari gambar lama |
| `npm run compress` | Konversi gambar lama ke WebP |

## Penyimpanan data — file biasa di komputer ini

Tidak ada database, tidak ada localStorage, tidak ada akun, tidak ada yang dikirim ke internet.
Semua data adalah file yang bisa Anda buka sendiri lewat Finder:

```
data/
  trades.json          seluruh trade — JSON rapi, bisa dibuka editor teks
  settings.json        pengaturan
  images/
    msx7a508_bm1il1.png    tiap screenshot sebagai file gambar utuh
    msx7b112_k9dm2p.png
```

- Saat app dibuka, isi `trades.json` dibaca dari disk.
- Setiap perubahan langsung ditulis kembali ke `trades.json`. Indikator kecil di kanan atas
  menandakan "✓ tersimpan" begitu file benar-benar tertulis.
- Screenshot yang Anda tempel/pilih disimpan sebagai file gambar di `data/images/`, dan
  `trades.json` hanya menyimpan nama filenya.

**Backup = salin folder `data/`.** Tidak perlu ekspor/impor apa pun.

### Kompresi gambar

Screenshot chart datang sebagai PNG retina — lossless dan boros. Server mengonversinya
ke **WebP q82** sebelum menulis ke disk. Diukur dari screenshot TradingView asli:
**510 KB → 117 KB, hemat ~77%**, tanpa perbedaan yang terlihat pada teks harga maupun
garis grid bahkan saat diperbesar 2×.

Artinya, dengan 5 gambar per trade:

| Intensitas | Tanpa kompresi | Dengan WebP |
| --- | --- | --- |
| 20 trade/bulan | 562 MB/tahun | 130 MB/tahun |
| 50 trade/bulan | 1.4 GB/tahun | 324 MB/tahun |
| 100 trade/bulan | 2.8 GB/tahun | 648 MB/tahun |

Pengaturan lewat variabel lingkungan:

```bash
WEBP_QUALITY=100 npm run dev    # WebP lossless (hemat ~63%)
COMPRESS=off npm run dev        # simpan apa adanya, tanpa konversi
```

GIF sengaja tidak disentuh (bisa animasi), dan bila hasil konversi ternyata lebih besar
dari aslinya, berkas asli yang dipakai — menyimpan screenshot lebih penting daripada
menghemat byte.

**Gambar lama** bisa dikonversi sekali jalan:

```bash
npm run compress:dry   # lihat dulu, tidak mengubah apa pun
npm run compress       # jalankan
```

Skrip ini mencadangkan `trades.json`, **memindahkan** file asli ke
`data/images-original-<tanggal>/` (bukan menghapusnya), lalu memperbarui rujukan.
Periksa gambarnya di app; kalau sudah beres, folder cadangan itu boleh dihapus.

Penulisan `trades.json` bersifat *atomik* — ditulis ke file sementara lalu di-rename — jadi
file tidak pernah tertinggal separuh tertulis meski proses mati di tengah penyimpanan.
Gambar yang tidak lagi dirujuk trade manapun dibersihkan otomatis setiap app dibuka.

Ingin data di luar folder project? Jalankan dengan variabel lingkungan:

```bash
DATA_DIR=~/Documents/TradingJournal npm run dev
```

Ini juga cara paling sederhana membuat backup otomatis — arahkan ke folder yang
sudah disinkronkan iCloud atau Dropbox:

```bash
DATA_DIR=~/Library/Mobile\ Documents/com~apple~CloudDocs/TradingJournal npm run dev
```

## Git: kode masuk, jurnal tidak

`data/` sudah masuk `.gitignore`. Itu disengaja, dengan dua alasan:

**Privasi.** `trades.json` memuat entry, size, leverage, P&L, dan catatan psikologi Anda;
`images/` memuat screenshot chart. Sekali ter-push, menghapusnya bukan sekadar `git rm` —
perlu menulis ulang seluruh riwayat repo.

**Git tidak pernah lupa.** Setiap versi file tersimpan permanen di riwayat, bahkan setelah
filenya dihapus dari folder kerja. Akibatnya kontra-intuitif: *mengompres gambar justru
membesarkan repo*, karena PNG lama tetap hidup di riwayat berdampingan dengan WebP baru.

Sebagai gambaran, batas GitHub saat ini: **100 MB per file** (ditolak keras), **1 GB**
ukuran repo yang disarankan, dan **5 GB** batas yang dianjurkan kuat.

Karena `data/` diabaikan, hasil `git clone` tidak membawa jurnal siapa pun — dan itu tidak
masalah: server membuat `data/trades.json` dan `data/images/` secara otomatis saat pertama
dijalankan. Clone baru langsung bisa dipakai dengan jurnal kosong.

Backup jurnal ditangani di luar git: salin folder `data/`, atau pakai `DATA_DIR` di atas.

## Fitur sesuai permintaan

**Screenshot — paste sebagai jalur utama**
Saat panel entri terbuka, tekan `⌘V` / `Ctrl+V` dan gambar dari clipboard langsung masuk ke
slot aktif, lalu slot aktif berpindah sendiri ke slot berikutnya — dua screenshot bisa ditempel
berurutan tanpa menyentuh mouse. Tetap bisa **tarik & lepas** file ke slot, atau **klik slot**
untuk memilih file dari komputer. Klik ⤢ membuka lightbox ukuran penuh.

**Pair — autocomplete**
Pair yang pernah Anda pakai muncul lebih dulu lengkap dengan jumlah pemakaian, disusul katalog
bawaan (kripto, forex, logam, indeks). Navigasi dengan `↑` `↓` lalu `Enter`. Pair baru tetap
boleh diketik bebas — otomatis masuk daftar setelah dipakai.

**Position Size — toggle USD ↔ unit pair**
Unit dasar terdeteksi otomatis dari nama pair: `BTCUSDT → BTC`, `XAUUSD → oz`, `EURUSD → EUR`,
`US100 → kontrak`. Nilai selalu **disimpan dalam unit dasar** supaya semua perhitungan PnL
memakai satu satuan; mode USD hanya cara memasukkannya — angka dolar dibagi harga entry.
Karena itu mode USD butuh Entry Price terisi lebih dulu. Nilai ekuivalen selalu tampil di
bawah input.

**Tutup sebagian posisi (scale out)**
Menutup 80% posisi bukan "menutup trade". Panel trade berjalan punya tiga mode —
`Edit rencana` · `◗ Sebagian` · `Penuh` — dan mode Sebagian hanya meminta tiga hal: berapa
persen, di harga berapa, fee berapa. Sisanya dihitung: lot yang keluar, R yang terkunci, lot
yang masih berjalan. Persen dihitung dari **sisa** posisi (tombol `Lot` menukar field ke satuan
lot bila broker melaporkan begitu), dan SL untuk sisa posisi bisa langsung digeser ke BE.
Trade tetap satu baris di jurnal; yang bertambah adalah daftar exit-nya. Tombol simpan
menyebut angkanya sendiri — "Tutup 80% & simpan" — supaya tidak ada penutupan penuh yang tidak
disengaja.

## Halaman

- **Dashboard** — baris metrik (Net PnL, Win Rate, Total Trades, R:R Aktual), equity curve
  dengan crosshair + tooltip dan toggle `$ / R / %`, daftar posisi berjalan, dan tabel histori
  yang baris-nya bisa diklik untuk membuka panel detail: niat · bukti · hasil berdampingan.
- **Kalender** — heatmap PnL harian. Intensitas warna mengikuti besaran PnL, bukan jumlah trade.
  Klik satu sel untuk melihat daftar trade hari itu.
- **Statistik** — performa per Strategi / Pair / Emosi / Timeframe / Arah, plus sebaran R dan
  PnL per hari dalam seminggu.
- **Tag** — pustaka tag dengan jumlah pemakaian, sparkline 5 trade terakhir, dan net PnL.
  Menu ⋯ untuk ubah nama, gabungkan dua ejaan yang sama, atau hapus.

## Siklus hidup trade

Satu trade dicatat dua kali: saat dibuka (rencana) dan saat ditutup (hasil).

1. **Berjalan** — Exit Price dan Realized PnL terkunci. Yang tampil hanya R rencana dari SL/TP
   berikut risikonya dalam dolar. Isi "harga terakhir" bila ingin melihat R floating.
2. **Di Dashboard** — posisi berjalan tampil di baris terpisah di atas histori. Angkanya
   **tidak** masuk Net PnL maupun Win Rate sampai trade ditutup.
3. **Tutup sebagian** *(opsional, berkali-kali)* — tombol "◗ Sebagian" mengeluarkan sebagian
   posisi. Trade tetap berstatus berjalan dengan penanda "Sebagian ditutup": bar dua warna
   menunjukkan berapa yang sudah keluar dan berapa yang masih di pasar, tiap exit jadi satu
   baris dengan waktu, porsi, harga, fee dan R-nya sendiri, dan risiko tersisa ditampilkan
   dalam dolar — setelah SL digeser ke BE angkanya nol.
4. **Tutup** — tombol "Tutup trade" (atau "Tutup sisa 20%") membuka panel yang sama dalam mode
   hasil. R aktual dan deviasi terhadap rencana dihitung otomatis, dengan label kata seperti
   "sesuai rencana" atau "exit terlalu cepat". Setiap perubahan menambah entri riwayat, jadi
   jurnal tetap jujur.

## Pintasan papan ketik

| Tombol | Aksi |
| --- | --- |
| `N` | Buka panel entri dari mana saja |
| `⌘↵` / `Ctrl+↵` | Simpan trade |
| `Esc` | Tutup panel (konfirmasi bila ada isian) |
| `⌘V` / `Ctrl+V` | Tempel screenshot ke slot aktif |
| `↑` `↓` `Enter` | Navigasi autocomplete pair |

## Catatan perhitungan

- PnL kotor = `(exit − entry) × size`, dibalik tandanya untuk Short. Bersih = kotor − fees.
- Risiko = `|entry − SL| × size` memakai **size awal** dan **SL awal** — dasar R tidak berubah
  walau sebagian posisi sudah ditutup atau SL digeser. **R rencana** =
  `|TP − entry| / |entry − SL|`; **R aktual** = `PnL bersih / risiko`. Tanpa SL, R tidak
  dihitung — PnL tetap tercatat.
- **Scale out** — PnL tiap exit dihitung sendiri (`(harga − entry) × lot exit − fee exit`) lalu
  dijumlahkan. Karena penyebutnya risiko awal, **R aktual otomatis menjadi rata-rata
  tertimbang** semua exit, bukan R dari harga exit terakhir — scale-out tidak membuat angkanya
  terlihat lebih buruk dari kenyataannya. Trade dengan beberapa exit tetap dihitung **satu
  trade** dan satu kemenangan di Win Rate; jumlah exit jadi kolom tersendiri yang bisa diurutkan
  di histori, supaya kebiasaan scale-out bisa dievaluasi terpisah.
- Selama sebagian posisi masih berjalan, PnL yang sudah terkunci **belum** masuk Net PnL maupun
  Win Rate. Yang tampil adalah "terkunci" (sudah realized) dan "floating" (sisa posisi).
- Win rate memakai total trade selesai sebagai penyebut, termasuk break-even.
- Expectancy = rata-rata R per trade. Angka paling jujur menilai strategi karena tidak
  bergantung pada ukuran akun.
- Realized PnL terisi otomatis tapi bisa ditimpa manual bila laporan broker berbeda; trade
  yang ditimpa ditandai di panel detail.

## Struktur

```
server/
  index.js                   satu-satunya bagian yang menyentuh disk
data/
  trades.json                data Anda
  images/                    screenshot
src/
  App.jsx                    navigasi, state global, indikator simpan, pintasan
  lib/
    storage.js               jembatan ke server (fetch /api/…)
    calc.js                  semua perhitungan — fungsi murni
    calc.test.mjs            34 pengujian
    pairs.js                 katalog pair + deteksi unit dasar
    format.js                pemformat angka & tanggal (id-ID)
  components/
    TradeForm.jsx            panel entri 520px · mode edit / sebagian / penuh
    PartialClose.jsx         form tutup sebagian (porsi %, exit, fee, SL sisa)
    ExitList.jsx             bar dua warna + daftar exit + sisa posisi
    ScreenshotSlots.jsx      paste / drop / pilih file
    PairAutocomplete.jsx     autocomplete pair
    PositionSizeInput.jsx    toggle USD ↔ unit
    EquityCurve.jsx          SVG chart + crosshair
    ui.jsx                   segmented, tag input, lightbox, dialog
  pages/                     Dashboard · Calendar · Stats · Tags
  styles.css                 token & komponen Nocturne
```
