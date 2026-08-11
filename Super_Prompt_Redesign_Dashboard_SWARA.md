# SUPER PROMPT — Redesign UI Dashboard SWARA Sesuai Mockup

> Cara pakai: salin seluruh isi file ini (dari "## KONTEKS" sampai akhir) dan
> tempelkan sebagai satu pesan ke AI coding assistant (Claude Code, Cursor, dsb)
> di dalam folder proyek `bps-audit-se2026`. Lampirkan juga gambar mockup
> (`mockup_swara.png`) pada pesan yang sama.

---

## KONTEKS

Kamu mengerjakan **SWARA (Sistem WhatsApp Responsif & Akurat)** — aplikasi web
internal BPS Kabupaten Karangasem untuk memverifikasi kunjungan petugas sensus
via WhatsApp. Stack: Node.js + Express + SQLite (`node:sqlite`) + Alpine.js +
Tailwind (CDN) + Chart.js + Socket.io. Satu-satunya file yang boleh kamu ubah
adalah `views/dashboard.html`. **Jangan ubah file backend** (`app.js`,
`database.js`, `wa-client.js`, `middleware/*`, `routes/*`) — tugas ini murni
redesign UI di atas kontrak API yang sudah ada.

Tujuan: mendesain ulang tampilan `views/dashboard.html` agar visualnya
mengikuti mockup terlampir (`mockup_swara.png`), **dengan penyesuaian**
(rincian di bagian PENYESUAIAN DARI MOCKUP di bawah), TANPA merusak satu pun
fungsi yang sudah tersambung ke backend nyata.

---

## ATURAN PALING PENTING — TIDAK BOLEH DILANGGAR

1. **Ini bukan mockup statis.** `dashboard.html` adalah aplikasi Alpine.js
   yang benar-benar memanggil endpoint Express yang hidup dan menyimpan ke
   SQLite. Setiap angka, badge, dan baris tabel di desain baru **harus**
   dirender dari `x-text` / `x-for` yang terikat ke state Alpine asli
   (`stats`, `rows`, `me`, `kegiatanList`, `pmlList`, `auditLog`, dst) —
   **bukan** angka hardcode hasil meniru mockup (mockup menampilkan
   `148`, `126`, `12`, `88%`, `172` — itu SEMUA data contoh/dummy dari
   perancangan, bukan angka yang boleh ditulis literal di kode baru).
2. **Jangan membuat ulang logika dari nol.** Semua `fetch()`, nama fungsi
   Alpine, nama field state, dan alur async yang sudah ada WAJIB dipertahankan
   persis (lihat INVENTARIS FUNGSI & STATE di bawah). Kamu boleh mengubah
   markup/HTML/class/struktur DOM sepenuhnya, tapi method binding
   (`@click="xxx()"`, `x-model="xxx"`, `x-text="xxx"`, `x-show="xxx"`) harus
   tetap memanggil nama yang sama persis kecuali kamu juga mengubah definisi
   method-nya secara konsisten di `<script>` — dan kalau kamu mengubahnya,
   perilakunya harus identik (input/output sama), hanya nama boleh berubah
   jika benar-benar perlu untuk kejelasan, dan WAJIB diubah di kedua tempat
   (definisi + pemanggilan) secara konsisten.
3. **Jangan menghapus fitur yang sudah ada** hanya karena tidak terlihat di
   mockup. Mockup ini simpel karena untuk keperluan visual awal — versi asli
   `dashboard.html` sudah punya banyak fitur produksi yang WAJIB tetap ada
   (daftar lengkap di bawah): modal Pakta Integritas, upload CSV, blast
   semua/terpilih, sampling acak, retensi/musnahkan nomor, reveal nomor
   (dicatat di audit), kelola kegiatan/survei, kelola PML + keanggotaan,
   jejak audit (khusus Admin), notifikasi toast & dialog konfirmasi custom
   (BUKAN `confirm()`/`alert()` browser), koneksi WhatsApp (QR code), dan
   listener Socket.io real-time.
4. **Jangan gunakan `localStorage`/`sessionStorage`.** Semua state persisten
   sudah lewat backend (session cookie + SQLite). Simpan hanya di variabel
   Alpine (in-memory).
5. **RBAC harus tetap ditegakkan di UI**, bukan cuma disembunyikan dengan CSS.
   Elemen yang di-`x-show="me.role === 'Admin'"` di versi lama harus tetap
   demikian di versi baru — JANGAN tampilkan kontrol Admin ke PML meskipun
   secara visual "terlihat rapi kalau semua orang lihat sama".
6. **Jangan hasilkan "AI slop".** Yang dimaksud di sini secara konkret:
   - Jangan pakai gradient sembarangan, shadow berlebihan, atau efek neon/glow
     yang tidak ada di mockup maupun brand BPS (biru institusional).
   - Jangan pakai ikon emoji. Pakai satu sistem ikon konsisten (SVG line-icon
     seperti di kode lama, atau Heroicons-outline style) — jangan campur gaya.
   - Jangan menambah teks placeholder generik seperti "Lorem ipsum",
     "Feature coming soon", atau elemen dekoratif yang tidak fungsional.
   - Jangan membuat komponen React/Vue — proyek ini murni HTML + Alpine.js
     dalam satu file, pertahankan pendekatan itu.
   - Jangan mengubah bahasa antarmuka dari Bahasa Indonesia ke Inggris.
   - Setiap komponen visual baru (kartu, badge, tab) harus dipetakan secara
     eksplisit ke field data backend yang nyata — kalau kamu tidak yakin data
     itu ada di API, TANYA dulu / periksa `app.js`, jangan mengarang endpoint.

---

## INVENTARIS FUNGSI & STATE YANG WAJIB DIPERTAHANKAN

### State Alpine (harus tetap ada, nama persis, di dalam `auditApp()`)
```
me, tab, kegiatanList, kegiatanDipilih, showKegiatan, formKegiatan,
kegiatanGalat, showPml, pmlList, formPml, pmlGalat, stats, rows, waReady,
hasQR, rekapSumber, auditLog, showAudit, search, filterStatus, filterPetugas,
filterSumber, selected, dibuka, showForm, form, blasting, paktaOK,
paktaVersi, paktaCentang, toasts, dlg, chart
```

### Method Alpine (harus tetap ada & tersambung endpoint yang sama)
| Method | Endpoint yang dipanggil | Fungsi |
|---|---|---|
| `init()` | — | inisialisasi: muat profil, cek pakta, refresh, pasang Socket.io listener |
| `muatProfilDanKegiatan()` | `GET /api/me`, `GET /api/kegiatan` | ambil role & daftar kegiatan sesuai user |
| `gantiKegiatan()` | — (trigger `refresh()`) | pindah konteks survei aktif |
| `tambahKegiatan()` | `POST /api/kegiatan` | Admin membuat survei baru |
| `cekPakta()` / `setujuiPakta()` | `GET/POST /api/pakta` | gerbang pakta integritas kerahasiaan data |
| `refresh()` | `GET /api/stats`, `/api/responden`, `/api/wa-status`, `/api/rekap-sumber`, `/api/audit-log` (khusus Admin) | polling tiap 5 detik |
| `addManual()` | `POST /api/responden` | tambah 1 responden manual |
| `uploadCsv()` | `POST /api/upload` | impor CSV |
| `blast()` | `POST /api/blast` | kirim WA ke semua PENDING dalam scope |
| `blastSelected()` | `POST /api/blast-selected` | kirim ke baris tercentang |
| `pilihSampel()` | `POST /api/sample` | ambil sampel acak |
| `resolve(id)` | `POST /api/resolve/:id` | tandai FRAUD → VALID_MANUAL |
| `bukaNomor(id)` | `GET /api/reveal/:id` | buka nomor penuh (tercatat di audit) |
| `musnahkanNomor()` | `POST /api/purge` | retensi — hapus permanen nomor lama |
| `resetAll()` | `POST /api/reset` | reset status semua data (uji coba) |
| `bukaKelolaPml()` / `buatPml()` / `togglePmlKegiatan()` | `GET/POST /api/pml`, `POST /api/pml/:id/kegiatan` | Admin kelola akun & keanggotaan PML |
| `logout()` | `POST /logout` | keluar |
| `qk(url)` / `bodyK(obj)` | — | helper: sisipkan `id_kegiatan` aktif ke query/body setiap panggilan |
| `toast()`, `konfirmasi()`, `input()`, `dlgOk()`, `dlgBatal()` | — | sistem notifikasi & dialog kustom (pengganti alert/confirm bawaan browser) |
| `copyRejection()`, `toggleAll()`, `matchesStatus()`, `badge()`, `label*()`, `nomorTampil()` | — | util tampilan |
| `renderQR()` | — | render QR code WhatsApp dari data Socket.io |
| `initChart()` / `updateChart()` | — | grafik donat Chart.js dari `stats` |

### Socket.io events yang harus tetap didengarkan
`wa-qr`, `wa-ready`, `wa-disconnected`, `balasan-baru`, `teguran-terkirim`,
`blast-selesai` — semua memicu update state dan/atau `toast()`.

### Bentuk data dari API (kontrak, jangan diasumsikan berbeda)
- `GET /api/me` → `{ nama, email, role: 'Admin'|'PML', scope: { id_kegiatan, pml_id, kegiatanDiikuti? } }`
- `GET /api/stats` → `{ total, terkirim, valid, fraud, pending, gagal }`
  (perhatikan: **tidak ada** field `response_rate` — kalau mockup butuh
  "Response Rate 88%", HITUNG di frontend dari `terkirim`/`total` atau
  `valid`/`terkirim`, JANGAN minta backend field baru tanpa menyebutkannya
  eksplisit sebagai "perlu perubahan backend" ke pengguna).
- `GET /api/responden` → array baris `{ id, nama_usaha, no_hp (tersamar),
  nama_petugas, no_hp_petugas (tersamar), status, balasan, sumber_data,
  id_kegiatan, pml_id, waktu_kirim, waktu_balas, created_at, _masked: true }`
  — status salah satu dari: `PENDING`, `TERKIRIM`, `VALID`, `VALID_MANUAL`,
  `FRAUD`, `GAGAL`.
- `GET /api/kegiatan` → array `{ id, kode, nama, aktif }` (terfilter per role).
- `GET /api/pml` → array `{ id, nama, email, kegiatan: [id,...] }`.
- `GET /api/audit-log` → array `{ id, user_email, aksi, detail, jumlah, ip, created_at }`
  (403 jika dipanggil oleh non-Admin — pastikan UI tidak memanggilnya untuk PML).

---

## PENYESUAIAN DARI MOCKUP (WAJIB diterapkan, bukan opsional)

Mockup terlampir adalah rancangan visual awal untuk BPS Karangasem dengan
branding lama ("SE2026 · QA System"). Terapkan penyesuaian berikut, jangan
tiru 1:1:

1. **Rebranding**: ganti semua "SE2026", "Dashboard Penjaminan Kualitas
   Data", "SE2026 · QA System" dengan **"SWARA"** dan tagline
   "Sistem WhatsApp Responsif & Akurat". Sistem ini sudah dirancang
   *survey-agnostic* (multi-kegiatan) — jangan sertakan nama survei spesifik
   di header/logo, karena nama kegiatan aktif sudah dinamis lewat
   `kegiatanDipilih`/`kegiatanList`.
2. **Sidebar navigasi di mockup** (Dashboard, Data Responden, Jalur Hijau,
   Indikasi Fraud, Laporan, Pengaturan sebagai menu terpisah) — versi asli
   memakai **tab di dalam satu halaman** (`tab: 'semua'|'hijau'|'fraud'`),
   bukan routing multi-halaman (tidak ada backend routing untuk halaman
   terpisah). **Pilihan yang benar**: pertahankan struktur single-page
   dengan tab, TAPI kamu boleh mengadopsi *gaya visual* sidebar dari mockup
   (rail gelap di kiri) sebagai penataan ulang navigasi tab + akses ke
   modal-modal (Kelola Survei, Kelola PML) — bukan sebagai multi-route baru.
   Jangan buat sidebar yang linknya tidak kemana-mana.
3. **Kartu statistik**: mockup punya 4 kartu (Total Terkirim, Valid, Fraud,
   Response Rate). Pertahankan makna field, tapi:
   - "Total Pesan Terkirim" → ikat ke `stats.terkirim` (bukan `stats.total`,
     karena "terkirim" secara semantik adalah pesan yang sudah dikirim).
   - "Response Rate" **dihitung di frontend**:
     `((stats.valid + stats.fraud) / (stats.terkirim || 1) * 100)`, dibulatkan.
   - Tambahkan kartu ke-5 jika perlu untuk `stats.pending` dan `stats.gagal`
     (mockup tidak menampilkannya, tapi data ini penting secara operasional
     dan sudah tersedia dari backend — jangan buang informasi yang sudah ada).
4. **Badge "PROTOTIPE RANCANGAN"** di mockup: HAPUS di versi produksi (ini
   penanda mockup, aplikasi sekarang sudah fungsional, bukan lagi rancangan).
5. **Status koneksi WA** ("WA Gateway Aktif" hijau): ikat ke `waReady`
   (boolean asli), termasuk kondisi `false`/menunggu QR — mockup hanya
   menunjukkan kondisi sukses, kamu WAJIB desain juga kondisi:
   belum terkoneksi (tampilkan tombol/area untuk memicu tampilnya QR code
   dari `renderQR()`), dan kondisi terputus (`wa-disconnected`).
6. **Avatar & identitas user** (pojok kanan atas "Administrator BPS /
   admin@bps.go.id"): ikat ke `me.nama` dan `me.email`, DAN tambahkan badge
   peran (`me.role`) yang tidak ada di mockup — ini penting karena sistem
   membedakan Admin/PML secara nyata.
7. **Sidebar footer** (mockup: "Administrator / PML · Karangasem / WITA ·
   v1.0 Prototipe"): boleh dipertahankan gayanya tapi update isinya jadi
   dinamis (`me.role`, nama kegiatan aktif dari `kegiatanAktif`), dan versi
   boleh tetap statis sebagai teks kecil non-data (mis. "SWARA v1.0").
8. **Tabel "Data Verifikasi Responden"**: mockup pakai 4 kolom (Nama Usaha,
   Petugas, Status, Waktu). Tabel asli PRODUKSI butuh lebih banyak kolom
   fungsional yang harus tetap ada dalam bentuk apa pun (boleh sebagian
   disembunyikan di layar sempit / expand row): nomor HP (tersamar, dengan
   tombol "buka" yang manggil `bukaNomor()`), sumber data, checkbox pilih
   (untuk `blastSelected()`), dan aksi (copy penolakan / resolve manual
   untuk baris FRAUD).
9. **Tab "Semua (148) / Jalur Hijau (126) / Indikasi Fraud (12)"** di
   mockup — pertahankan konsep dan angka dinamis dari `rows.length` +
   filter, tapi jangan hardcode angka. Field `tab` di state harus tetap
   dipakai sebagai penentu filter (lihat `matchesStatus()`).
10. **Warna**: pertahankan palet biru institusional BPS + hijau (valid) +
    merah (fraud) + amber (menunggu/pending) sesuai mockup, tapi pastikan
    kontras teks di atas warna latar memenuhi keterbacaan (teks gelap di
    atas latar terang, bukan putih di atas latar pastel terang).
11. **Elemen yang WAJIB DITAMBAHKAN meski tidak ada di mockup** (karena
    krusial secara fungsional dan sudah ada di versi lama):
    - Modal Pakta Integritas (gerbang wajib sebelum lihat data — jangan
      dihapus, ini pengaman kerahasiaan data BPS).
    - Selector kegiatan/survei aktif (dropdown `kegiatanList` +
      `kegiatanDipilih`) — untuk Admin bisa pindah kegiatan, PML hanya
      lihat yang ia ikuti.
    - Modal "Kelola Survei" (Admin: `tambahKegiatan()`).
    - Modal "Kelola PML" (Admin: `buatPml()`, `togglePmlKegiatan()`).
    - Panel/tabel "Jejak Audit" khusus Admin (`auditLog`, `x-show="me.role
      === 'Admin'"`).
    - Form tambah manual + upload CSV + tombol sampling acak.
    - Sistem toast & dialog konfirmasi kustom (JANGAN gunakan
      `window.confirm`/`window.alert`/`window.prompt` bawaan browser).
    - Tombol retensi/musnahkan nomor (khusus Admin, dengan konfirmasi
      "bahaya" via `konfirmasi()`).

---

## STACK & BATASAN TEKNIS

- Satu file HTML (`views/dashboard.html`) berisi markup + `<style>` (jika
  perlu kustomisasi di luar utility Tailwind) + `<script>` Alpine, seperti
  struktur aslinya. Jangan pecah jadi banyak file/build step (tidak ada
  bundler di proyek ini — Tailwind & Alpine dimuat via CDN `<script>`).
- Tailwind CDN, Alpine.js CDN, Chart.js CDN, Socket.io client — pertahankan
  cara pemuatan pustaka yang sama seperti file asli (lihat `<head>` file
  lama sebelum menulis ulang).
- Bahasa UI: **Bahasa Indonesia**, nada formal-instansional (ini aplikasi
  pemerintah, bukan produk konsumen).
- Aksesibilitas dasar: kontras cukup, elemen interaktif punya `aria-label`
  bila hanya berupa ikon, modal bisa ditutup dengan `Escape`
  (`@keydown.escape.window`, sudah ada di versi lama — pertahankan).
- Responsif: mockup ini desain desktop lebar. Tambahkan breakpoint mobile
  (Tailwind `sm:`/`md:`/`lg:`) mengikuti pola yang sudah ada di file lama —
  JANGAN buat versi yang hanya berfungsi di layar lebar.

---

## LANGKAH KERJA YANG DIMINTA

1. Baca `views/dashboard.html` yang ada saat ini secara menyeluruh dulu —
   catat semua binding (`x-model`, `x-text`, `@click`, dst) sebelum menulis
   ulang apa pun.
2. Rancang ulang HTML/CSS mengikuti gaya visual mockup (warna, tipografi,
   kartu, tata letak) dengan penyesuaian di atas — pertahankan SELURUH
   `<script>` Alpine (state + method) fungsinya identik; kamu boleh merapikan
   kode JS-nya asal perilaku & nama binding yang dipanggil dari HTML tetap
   konsisten.
3. Setelah selesai, buat **daftar periksa (checklist) tertulis** yang
   memetakan setiap elemen visual baru → binding Alpine → endpoint API yang
   ia panggil, supaya bisa diverifikasi tidak ada fitur backend yang
   "menggantung" tanpa UI atau UI yang tidak tersambung apa pun.
4. Jangan jalankan `npm install` atau ubah `package.json` — tidak ada
   dependensi baru yang dibutuhkan untuk tugas ini.
5. Jika ternyata ada kebutuhan tampilan di mockup yang **tidak mungkin**
   dipenuhi tanpa mengubah backend (field data yang belum ada, endpoint yang
   belum ada) — JANGAN mengarang data palsu di frontend. Laporkan secara
   eksplisit ke saya sebagai "butuh perubahan backend: ..." alih-alih diam-
   diam melewatkannya atau membuat angka statis.

---

## KRITERIA SELESAI (definition of done)

- [ ] Tidak ada satu pun angka/teks statis yang meniru contoh dari mockup
      (148, 126, 12, 88%, 172, "Warung Makan Bu Ayu", dst) — semua dari data
      Alpine yang terikat API sungguhan.
- [ ] Semua method & state di tabel INVENTARIS masih ada dan dipanggil dari
      tempat yang sesuai secara fungsional.
- [ ] RBAC visual (Admin vs PML) masih ditegakkan persis seperti sebelumnya.
- [ ] Modal Pakta Integritas masih memblokir akses sebelum disetujui.
- [ ] Tidak memakai `alert()`/`confirm()`/`prompt()` bawaan browser di mana
      pun.
- [ ] Tidak memakai `localStorage`/`sessionStorage`.
- [ ] Halaman tetap satu file `views/dashboard.html`, tidak menambah file
      atau dependensi baru.
- [ ] Sudah diuji (jelaskan caranya, mis. cek konsistensi nama fungsi antara
      HTML dan `<script>`, atau jalankan aplikasi lokal jika memungkinkan)
      bahwa tidak ada `ReferenceError` untuk method Alpine yang hilang.
- [ ] Menyertakan checklist pemetaan visual → binding → endpoint seperti
      diminta di langkah kerja no. 3.

---

## LAMPIRAN

- `mockup_swara.png` — rancangan visual acuan (lihat catatan penyesuaian di
  atas, JANGAN ditiru 1:1).
