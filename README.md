# SWARA
Sistem Whatsapp Responsif dan Akurat (SWARA) - Projek Latsar CPNS BPS Gol. 3 Akt. 9 by I Made Yoga Andika Putra

# Sistem Instant Feedback Loop — Audit SE2026 BPS Karangasem

Auto WhatsApp Blast & Response Listener untuk verifikasi kunjungan petugas Sensus Ekonomi 2026.
**Zero budget** — tanpa API berbayar, berjalan penuh di PC kantor.

---

## Tech Stack
- **Backend:** Node.js + Express.js
- **WA Gateway (gratis):** `whatsapp-web.js` (login via QR di terminal)
- **Database:** **SQLite bawaan Node.js** (`node:sqlite`) — tanpa install & tanpa kompilasi
- **Frontend:** HTML + Tailwind CSS (CDN) + Alpine.js + Chart.js

> Catatan: proyek ini **tidak lagi memakai `better-sqlite3`**. Kita pakai SQLite yang
> sudah menyatu di Node.js sehingga tidak butuh Python / Visual Studio Build Tools.

---

## Struktur Folder
```
bps-audit-se2026/
├── app.js                # Server Express + semua endpoint API
├── database.js           # SQLite (node:sqlite) + schema + query helper
├── wa-client.js          # Gateway WhatsApp (QR, listener balasan, blast)
├── package.json
├── sample_responden.csv  # Contoh data untuk uji upload
├── views/
│   └── dashboard.html    # UI dashboard (Tailwind + Alpine + Chart.js)
├── public/               # Aset statis (opsional)
├── uploads/              # File CSV sementara (otomatis dibersihkan)
└── data/                 # File database SQLite dibuat otomatis di sini
```

---

## Modul Autentikasi & Automation (Baru)
Sistem kini bernama **SE-2026 Quality Assurance System** dengan tambahan:
- **Login/Signup/Forgot Password** (Passport Local + bcryptjs) dan **Login with Google** (OAuth 2.0).
- Semua halaman & API dashboard **dilindungi** (wajib login).
- **Auto-Teguran**: begitu responden membalas `2` (Fraud), sistem otomatis mengirim WA ke nomor petugas (`NO_HP_PETUGAS`) agar mengunjungi ulang lokasi dalam 24 jam.
- **Daily Push (17:00)**: `node-cron` mengirim ringkasan harian ke nomor PML (`SUPERVISOR_PHONE`).
- Tab **Jalur Hijau** (Valid) & **Indikasi Fraud**, plus tombol **One-Click Copy** teks penolakan.

> Catatan `bcrypt`: proyek memakai **`bcryptjs`** (pure-JS, tanpa kompilasi) sebagai pengganti drop-in `bcrypt`, agar tidak memerlukan Python/Build Tools di PC kantor. API-nya sama (`hashSync`/`compareSync`).

### Konfigurasi `.env` (wajib)
Salin `.env.example` menjadi `.env`, lalu isi minimal `SESSION_SECRET`. Untuk Google & Daily Push, isi juga `GOOGLE_CLIENT_ID/SECRET` dan `SUPERVISOR_PHONE`.
```powershell
Copy-Item .env.example .env
```

---

## Mitigasi Tata Kelola Data (Isu Penguji 1 & 2)

### Isu 1 — Kerahasiaan data (mis. tarikan dari SQL Lab)
Sistem tidak sekadar "berjanji" menjaga rahasia, tetapi **memaksakan** perlakuan rahasia lewat fitur:

| Fitur | Cara kerja |
|---|---|
| **Pakta Integritas digital** | Modal pemblokir saat login. Data tidak dapat diakses sebelum pengguna menyetujui pernyataan kerahasiaan (rujukan UU 16/1997 & UU 27/2022). Persetujuan + versi naskah tersimpan di tabel `users`. |
| **Minimalisasi data** | Hanya 4 atribut yang diproses: nama usaha, no HP responden, nama petugas, no HP petugas. Tidak ada omzet/NPWP/isi kuesioner. |
| **Masking nomor** | Nomor tampil `0813****794`. Nomor mentah (`wa_id`) **tidak pernah** dikirim ke browser. |
| **Buka nomor terkontrol** | Ikon mata membuka nomor penuh satu baris; setiap pembukaan dicatat di jejak audit. |
| **Jejak audit (audit trail)** | Tabel `audit_log` mencatat LOGIN, SETUJU_PAKTA, IMPOR/TAMBAH DATA, BUKA_NOMOR, BLAST, EKSPOR, VALIDASI_MANUAL, MUSNAHKAN_NOMOR — lengkap dengan pengguna, waktu, IP, jumlah baris. Tampil di panel "Jejak Audit Akses Data". |
| **Ekspor berwatermark** | Baris pertama CSV memuat identitas pengunduh, waktu, mode, dan peringatan hukum. Default ekspor **tersamar**; nomor penuh hanya via `?penuh=1` dan tercatat terpisah di audit. |
| **Retensi & pemusnahan** | Tombol "Retensi" menghapus permanen nomor HP untuk data yang sudah selesai diverifikasi melebihi N hari. Status & statistik tetap utuh untuk laporan. |

### Isu 2 — Tidak semua survei dapat ditarik dari SQL Lab
Arsitektur dibuat **source-agnostic** — SQL Lab hanyalah salah satu sumber, bukan syarat:

| Fitur | Cara kerja |
|---|---|
| **Kolom `SUMBER_DATA`** | Setiap baris menyimpan asal-usulnya: `SQL_LAB`, `CAPI`, `MANUAL_PML`, atau `LAINNYA`. Tersedia di CSV, form manual, kolom tabel, dan hasil ekspor. |
| **Empat jalur masuk data** | (a) ekspor SQL Lab, (b) CSV dari aplikasi CAPI, (c) rekap manual PML, (d) input satuan lewat form. Semua bermuara ke template baku yang sama. |
| **Filter & rekap provenance** | Dropdown "Semua Sumber" pada tabel, plus rekap jumlah per sumber di panel audit — memudahkan pelaporan asal data. |
| **Verifikasi berbasis sampel acak** | Tombol "Sampel Acak" memilih N responden secara acak dari data berstatus Menunggu, lalu mencentangnya untuk "Blast Terpilih". Berguna saat kerangka data tidak lengkap; efek jera tetap bekerja karena petugas tidak tahu kunjungan mana yang diverifikasi. |

> Catatan: mitigasi untuk isu ketiga (kanal WhatsApp pihak ketiga) **ditunda**; purwarupa saat ini difokuskan pada pembuktian konsep manfaat sistem.

---

## Prasyarat
- **Node.js versi 22.13 atau lebih baru** (Node 24 sangat disarankan). Cek: `node -v`.
  SQLite bawaan (`node:sqlite`) aktif otomatis mulai Node 22.13, tanpa flag apa pun.
- Koneksi internet **saat `npm install`** (untuk mengunduh Chromium milik puppeteer).
- Sebuah **nomor WhatsApp** untuk dijadikan gateway (disarankan nomor khusus dinas).

Tidak perlu Python, tidak perlu Visual Studio Build Tools.

---

## Cara Instalasi & Menjalankan

**1. Masuk ke folder proyek**
```bash
cd bps-audit-se2026
```

**2. Install dependency**
```bash
npm install
```

**3. Jalankan aplikasi**
```bash
npm start
```

**4. Scan QR Code**
Di terminal muncul QR Code. Buka WhatsApp di HP →
**Setelan → Perangkat Tertaut → Tautkan Perangkat** → scan QR.
Setelah muncul `[WA] ✅ Gateway SIAP`, gateway aktif. (Sesi tersimpan, tak perlu scan ulang.)

**5. Buka Dashboard**
Kunjungi **http://localhost:3000**.

> Saat start akan muncul baris `ExperimentalWarning: SQLite is an experimental feature`.
> Ini **normal dan aman diabaikan** — hanya penanda bahwa SQLite bawaan Node masih berstatus eksperimental.

---

## Jika Sebelumnya Sudah Gagal `npm install`
Kalau tadi install pernah error (mis. soal `better-sqlite3`/Python atau `EPERM`), bersihkan dulu:

1. Tutup semua yang memakai folder ini (VS Code, terminal lain, antivirus scan, sinkronisasi OneDrive).
2. Hapus folder `node_modules` dan file `package-lock.json` di dalam proyek.
   - Lewat PowerShell:
     ```powershell
     Remove-Item -Recurse -Force node_modules, package-lock.json
     ```
   - Jika `EPERM`/akses ditolak: pindahkan folder proyek keluar dari **Downloads/OneDrive**
     (mis. ke `C:\bps-audit-se2026`), lalu ulangi.
3. Install ulang: `npm install`
4. Jalankan: `npm start`

---

## Soal Browser (Chromium untuk WhatsApp Web)
`whatsapp-web.js` menjalankan WhatsApp Web di balik layar memakai browser Chromium.
Aplikasi ini **otomatis mendeteksi Google Chrome atau Microsoft Edge** yang sudah
terpasang di PC (Edge hampir selalu ada di Windows 10/11), jadi normalnya Anda
**tidak perlu mengunduh apa pun**.

Jika muncul error `Could not find Chrome ...`, pilih salah satu:
- **(A) Termudah — pakai browser yang ada:** pastikan Google Chrome atau Microsoft Edge
  terpasang, lalu jalankan ulang `npm start`. Aplikasi akan memakainya otomatis.
  Untuk menunjuk lokasi browser secara manual (PowerShell):
  ```powershell
  $env:CHROME_PATH="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"; npm start
  ```
- **(B) Unduh Chromium khusus puppeteer** (butuh internet yang tidak memblokir):
  ```powershell
  npx puppeteer browsers install chrome
  ```
  lalu `npm start` lagi.

---

## Cara Pakai
1. **Impor data** — klik **Upload CSV** (pakai `sample_responden.csv`), atau **Tambah Manual**.
   Kolom CSV wajib: `nama_usaha`, `no_hp`, `nama_petugas`.
2. **Kirim Blast WA** — klik tombol oranye. Pesan verifikasi dikirim ke semua responden
   berstatus *Menunggu*, dengan jeda 6–15 detik antar pesan.
3. **Pantau otomatis** — saat responden membalas **1** (Valid) atau **2** (Fraud),
   status di tabel & kartu statistik terupdate sendiri setiap 5 detik.

---

## Catatan Penting (Wajib Dibaca)
- **Risiko pemblokiran:** `whatsapp-web.js` tidak resmi. Blast massal ke banyak nomor asing
  bisa memicu pembatasan/blokir WhatsApp. Gunakan **nomor khusus**, mulai dari skala kecil,
  dan pertahankan jeda antar pesan (sudah diatur 6–15 detik).
- **Kerahasiaan data:** nomor & identitas responden tunduk pada kerahasiaan data BPS.
  Pastikan pemanfaatannya sesuai ketentuan instansi.
- **Backup sesi:** folder `.wwebjs_auth/` menyimpan sesi login. Menghapusnya = scan QR ulang.
- **Backup data:** seluruh data di `data/audit.sqlite`. Salin file itu untuk backup.

---

## Troubleshooting Singkat
| Masalah | Solusi |
|---|---|
| `find Python ... NOT SUPPORTED` saat install | Sudah tidak relevan — proyek ini tak lagi butuh kompilasi. Pastikan pakai `package.json` versi terbaru (tanpa better-sqlite3), lalu bersihkan `node_modules` & install ulang. |
| `No such built-in module: node:sqlite` | Node Anda terlalu lama. Update ke Node 22.13+ / 24 dari nodejs.org. |
| `Could not find Chrome ...` | Pastikan Chrome/Edge terpasang lalu `npm start` lagi (auto-terdeteksi). Atau set `CHROME_PATH`, atau jalankan `npx puppeteer browsers install chrome`. Lihat bagian "Soal Browser". |
| `EPERM: operation not permitted` | Tutup editor/antivirus/OneDrive yang mengunci folder; pindahkan proyek ke `C:\` lalu ulangi. |
| QR tidak muncul | Lebarkan jendela terminal; jalankan ulang `npm start`. |
| "Gateway WA belum siap" | Tunggu status navbar hijau (`WA Gateway Aktif`). |
| Port 3000 dipakai | `PORT=4000 npm start` (PowerShell: `$env:PORT=4000; npm start`). |
