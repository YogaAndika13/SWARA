# SWARA — Sistem WhatsApp Responsif & Akurat

Alat penjaminan kualitas data lapangan untuk **BPS Kabupaten Karangasem**.
SWARA mengirim pesan verifikasi via WhatsApp kepada responden, menanyakan apakah
petugas benar-benar berkunjung, lalu memperbarui dashboard begitu balasan masuk —
*instant feedback loop*.

**Zero budget:** tanpa API berbayar, tanpa server sewaan, tanpa kompilasi.
Berjalan penuh di satu PC kantor.

> Sistem ini **survey-agnostic**. Awalnya dibuat untuk Sensus Ekonomi 2026, kini
> melayani banyak kegiatan pendataan lewat tabel `kegiatan` (SE2026, Susenas, dsb).

---

## Tech Stack
- **Backend:** Node.js + Express
- **Gateway WA (gratis):** `whatsapp-web.js` — login sekali via QR
- **Basis data:** SQLite **bawaan Node.js** (`node:sqlite`) — tanpa instalasi, tanpa kompilasi
- **Realtime:** Socket.io
- **Autentikasi:** Passport (Local + Google OAuth opsional), `bcryptjs`
- **Frontend:** HTML + Tailwind CSS (CDN) + Alpine.js + Chart.js — tanpa build step

> Tidak memakai `better-sqlite3` maupun `bcrypt` versi native, sehingga **tidak
> memerlukan Python atau Visual Studio Build Tools**.

---

## Struktur Folder
```
bps-audit-se2026/
├── app.js                  # Server Express + seluruh endpoint API
├── database.js             # SQLite (node:sqlite): skema, migrasi, query ter-scope
├── wa-client.js            # Gateway WhatsApp (QR, listener balasan, blast, auto-teguran)
├── scheduler.js            # Cron: laporan harian + cadangan basis data
├── start-swara.bat         # Jalankan & nyalakan ulang otomatis (Windows)
├── start-swara-tunnel.bat  # Idem + terowongan Cloudflare (akses dari luar kantor)
├── package.json
├── .env.example            # Contoh konfigurasi -> salin jadi .env
├── sample_responden.csv    # Contoh data untuk uji impor
├── config/
│   ├── passport.js         # Strategi Local & Google
│   └── sqlite-session-store.js  # Sesi login disimpan di SQLite (tahan restart)
├── middleware/
│   ├── auth.js             # ensureApi, ensurePage, requireRole, attachScope
│   └── rate-limit.js       # Pembatas percobaan login (tanpa dependensi luar)
├── routes/
│   └── auth.js             # /login, /signup, /forgot, /reset, /auth/google, /logout
├── views/
│   ├── dashboard.html      # Dashboard utama (Alpine + Tailwind + Chart.js)
│   ├── login.html          # Halaman masuk
│   ├── signup.html         # Registrasi mandiri (nonaktif secara baku)
│   ├── forgot.html         # Permintaan tautan reset
│   └── reset.html          # Penetapan password baru
├── public/                 # Aset statis (opsional)
├── uploads/                # CSV sementara (dibersihkan otomatis)
└── data/
    ├── audit.sqlite        # Basis data (dibuat otomatis)
    ├── backup/             # Cadangan harian audit-YYYY-MM-DD.sqlite
    ├── swara.log           # Log runtime bila dijalankan via start-swara.bat
    └── tunnel.log          # Log terowongan + ALAMAT PUBLIK (start-swara-tunnel.bat)
```

---

## Prasyarat
- **Node.js 22.13 atau lebih baru** (Node 24 disarankan). Cek dengan `node -v`.
  `node:sqlite` tersedia otomatis sejak Node 22.13, tanpa flag.
- **Google Chrome atau Microsoft Edge** sudah terpasang (Edge hampir selalu ada di
  Windows 10/11). Chromium milik Puppeteer sengaja **tidak** diunduh.
- Koneksi internet **hanya saat `npm install`**, untuk mengunduh paket npm.
- Satu **nomor WhatsApp** sebagai gateway — sangat disarankan nomor khusus dinas,
  bukan nomor pribadi.

---

## Instalasi

```bash
cd bps-audit-se2026
npm install
```

**Siapkan konfigurasi** (wajib — server menolak jalan tanpa ini):

```powershell
Copy-Item .env.example .env
```

Buat kunci sesi acak, lalu tempelkan ke `SESSION_SECRET` di `.env`:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> `SESSION_SECRET` menandatangani cookie login. Bila kosong, memakai nilai contoh,
> atau kurang dari 16 karakter, **server sengaja menolak start** — kunci lemah
> memungkinkan orang memalsukan sesi Admin tanpa password.

**Jalankan:**

```bash
npm start        # atau: npm run dev  (auto-reload saat berkas berubah)
```

Agar SWARA hidup sendiri setiap komputer menyala dan menyala ulang bila berhenti,
gunakan `start-swara.bat` (petunjuk pendaftaran ke Task Scheduler ada di dalam berkasnya).

**Tautkan WhatsApp:** QR muncul di terminal *dan* di dashboard. Buka WhatsApp di HP →
**Setelan → Perangkat Tertaut → Tautkan Perangkat** → pindai. Setelah `[WA] ✅ Gateway SIAP`,
status di dashboard berubah hijau. Sesi tersimpan di `.wwebjs_auth/`, jadi pemindaian
hanya sekali.

**Buka dashboard:** <http://localhost:3000>

### Diakses dari komputer/HP lain

`localhost` hanya berlaku di komputer server itu sendiri. Untuk pengguna lain:

| Pengguna berada di | Yang perlu disiapkan |
|---|---|
| **Jaringan kantor** | Beri komputer server IP tetap (DHCP reservation di router), lalu buka port di Windows Firewall: `New-NetFirewallRule -DisplayName "SWARA 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Private`. Pengguna membuka `http://<IP-server>:3000`. |
| **Lapangan (paket data)** | Jalankan **`start-swara-tunnel.bat`** — ia menyalakan server *dan* terowongan Cloudflare sekaligus. Tidak perlu IP publik maupun membuka port router. Persiapan `cloudflared` dijelaskan di dalam berkas itu; alamat publiknya muncul di `data\tunnel.log`. |

Aplikasi sudah siap untuk skenario terowongan: `app.set('trust proxy', 1)` dan
`cookie.secure = 'auto'` membuat cookie sesi benar baik lewat HTTP lokal maupun
HTTPS tunnel, dan tautan reset password otomatis memakai alamat publik yang aktif.

> **Keamanan:** begitu alamat publik hidup, halaman login terbuka bagi siapa pun yang
> mengetahui alamatnya. Pasang **Cloudflare Access** (gratis s.d. 50 pengguna) di
> depannya agar hanya surel terdaftar yang dapat mencapai halaman login.
>
> Bila `GOOGLE_CLIENT_ID`/`SECRET` diisi, `GOOGLE_CALLBACK_URL` **wajib** diubah ke
> alamat publik dan didaftarkan ulang di Google Cloud Console — bila tidak, login
> Google gagal dengan `redirect_uri_mismatch`.

> Baris `ExperimentalWarning: SQLite is an experimental feature` saat start adalah
> **normal** — hanya penanda bahwa SQLite bawaan Node masih berstatus eksperimental.

### Akun pertama
Saat pertama kali dijalankan, sistem membuat akun Admin:

| Email | Password |
|---|---|
| `admin@bps.go.id` | `bps12345` |

Password ini **wajib diganti saat login pertama** — dashboard diblokir sampai
password baru ditetapkan (minimal 8 karakter). Akun PML berikutnya dibuat Admin
lewat menu **Kelola PML**; pendaftaran mandiri nonaktif secara baku
(aktifkan dengan `ALLOW_SIGNUP=1` bila memang diperlukan).

---

## Konfigurasi `.env`

| Variabel | Guna |
|---|---|
| `PORT` | Port server (baku `3000`). |
| `SESSION_SECRET` | **Wajib.** Kunci acak penanda tangan cookie sesi. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Opsional — mengaktifkan "Masuk dengan Google". |
| `ALLOW_SIGNUP` | `1` untuk mengizinkan pendaftaran mandiri. Baku: nonaktif. |
| `SUPERVISOR_PHONE` | Nomor penerima laporan harian. |
| `DAILY_PUSH_CRON` | Jadwal laporan harian (baku `0 17 * * *` = 17:00). |
| `CRON_TIMEZONE` | Zona waktu cron (baku `Asia/Makassar`). |
| `BACKUP_CRON` | Jadwal cadangan basis data (baku `0 2 * * *` = 02:00). |
| `BACKUP_KEEP` | Berapa hari cadangan disimpan (baku `14`). |
| `CHROME_PATH` | Lokasi Chrome/Edge bila deteksi otomatis gagal. |

---

## Peran & Isolasi Data

Ada dua peran, ditegakkan **di server**, bukan sekadar disembunyikan di tampilan:

| | **Admin** | **PML** |
|---|---|---|
| Data yang terlihat | Seluruh data pada kegiatan yang dipilih | Hanya barisnya sendiri |
| Kelola survei/kegiatan | ✅ | — |
| Kelola akun PML & keanggotaan | ✅ | — |
| Jejak audit | ✅ | — |
| Retensi / pemusnahan nomor | ✅ | — |
| Impor, blast, sampel, ekspor | ✅ | ✅ (terbatas datanya sendiri) |

Setiap query yang menyentuh tabel `responden` melewati penyaring
`kegiatan` + `pml_id`. Saat menambah endpoint baru, **wajib** memakai fungsi
`*Scoped` di `database.js` — jangan pernah memakai pasangan tanpa scope
(`getAll`, `resetAll`, `purgeNomorLama`, dst.) dari sebuah route.

---

## Tata Kelola Kerahasiaan Data

| Fitur | Cara kerja |
|---|---|
| **Pakta Integritas digital** | Modal pemblokir saat login. Data tak dapat diakses sebelum pernyataan kerahasiaan disetujui (rujukan UU 16/1997 & UU 27/2022). Persetujuan + versi naskah tersimpan di tabel `users`. |
| **Minimalisasi data** | Hanya 4 atribut diproses: nama usaha, no HP responden, nama petugas, no HP petugas. Tidak ada omzet/NPWP/isi kuesioner. |
| **Masking nomor** | Nomor tampil `0813****794`. Nomor mentah (`wa_id`) **tidak pernah** dikirim ke browser. |
| **Buka nomor terkontrol** | Ikon mata membuka satu nomor penuh; setiap pembukaan tercatat di jejak audit. |
| **Jejak audit** | Tabel `audit_log` mencatat LOGIN, SETUJU_PAKTA, GANTI_PASSWORD, IMPOR/TAMBAH DATA, BUKA_NOMOR, BLAST, PILIH_SAMPEL, EKSPOR, VALIDASI_MANUAL, RESET_STATUS, MUSNAHKAN_NOMOR — lengkap dengan pengguna, waktu, IP, jumlah baris. |
| **Ekspor berwatermark** | Baris pertama CSV memuat identitas pengunduh, waktu, mode, dan peringatan hukum. Baku **tersamar**; nomor penuh hanya via `?penuh=1` dan tercatat terpisah. Isi ekspor mengikuti hak akses pengunduh. |
| **Anti CSV injection** | Sel yang diawali `=` `+` `-` `@` diberi kutip tunggal agar tidak dieksekusi sebagai rumus saat dibuka di Excel/Sheets. |
| **Retensi & pemusnahan** | Tombol "Retensi" (Admin) menghapus permanen nomor HP untuk data yang selesai melebihi N hari. Status & statistik tetap utuh untuk laporan. |

---

## Sumber Data Beragam

Arsitektur **source-agnostic** — SQL Lab hanya salah satu sumber, bukan syarat.

| Fitur | Cara kerja |
|---|---|
| **Kolom `SUMBER_DATA`** | Setiap baris menyimpan asal-usulnya: `SQL_LAB`, `CAPI`, `MANUAL_PML`, `LAINNYA`. |
| **Empat jalur masuk** | (a) ekspor SQL Lab, (b) CSV dari CAPI, (c) rekap manual PML, (d) input satuan. Semua bermuara ke template baku yang sama. |
| **Filter & rekap provenance** | Dropdown "Semua Sumber" pada tabel, plus rekap jumlah per sumber. |
| **Verifikasi berbasis sampel** | "Sampel Acak" memilih N responden acak berstatus *Menunggu*. Berguna saat kerangka data tak lengkap; efek jera tetap bekerja karena petugas tidak tahu kunjungan mana yang diverifikasi. |

---

## Format CSV Impor

Unduh contoh lewat tombol **Template** di dashboard, atau lihat `sample_responden.csv`.

| Kolom | Wajib | Keterangan |
|---|---|---|
| `nama_usaha` | ✅ | Nama usaha/responden. |
| `no_hp` | ✅ | Nomor responden (`08...` atau `62...`). |
| `nama_petugas` | ✅ | Nama pencacah yang berkunjung. |
| `no_hp_petugas` | — | Dipakai fitur **Auto-Teguran** saat responden membalas `2`. |
| `sumber_data` | — | `SQL_LAB` / `CAPI` / `MANUAL_PML` / `LAINNYA`. Baku `MANUAL_PML`. |

---

## Alur Status Responden

```
PENDING ──blast──> TERKIRIM ──balas "1"──> VALID
                       │
                       ├────balas "2"──> FRAUD ──validasi manual──> VALID_MANUAL
                       │                    └── auto-teguran ke petugas
                       └──gagal kirim──> GAGAL
```

---

## Cadangan & Pemulihan
- Cadangan otomatis setiap hari (baku 02:00) ke `data/backup/audit-YYYY-MM-DD.sqlite`,
  disimpan 14 hari terakhir.
- **Pulihkan:** hentikan server, salin berkas cadangan menjadi `data/audit.sqlite`
  (hapus dulu `audit.sqlite-wal` dan `audit.sqlite-shm` bila ada), lalu jalankan lagi.
- Salin folder `data/backup/` ke media lain secara berkala — cadangan di disk yang
  sama tidak menolong bila disknya yang rusak.
- Folder `.wwebjs_auth/` menyimpan sesi WhatsApp. Menghapusnya = pindai QR ulang.

---

## Soal Browser (Chromium untuk WhatsApp Web)
`whatsapp-web.js` menjalankan WhatsApp Web di balik layar memakai Chromium.
Aplikasi ini **otomatis mendeteksi Google Chrome atau Microsoft Edge** yang sudah
terpasang, jadi normalnya Anda **tidak perlu mengunduh apa pun**.

Bila muncul `Could not find Chrome ...`:
- **(A) Termudah:** pastikan Chrome/Edge terpasang lalu `npm start` lagi. Untuk
  menunjuk lokasinya secara manual (PowerShell):
  ```powershell
  $env:CHROME_PATH="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"; npm start
  ```
- **(B) Unduh Chromium khusus puppeteer** (butuh internet yang tidak memblokir):
  ```powershell
  npx puppeteer browsers install chrome
  ```

---

## Catatan Penting
- **Risiko pemblokiran:** `whatsapp-web.js` tidak resmi. Blast massal ke banyak nomor
  asing dapat memicu pembatasan/blokir. Gunakan nomor khusus, mulai dari skala kecil,
  dan **jangan menghapus atau memperpendek jeda 6–15 detik antar pesan** — jeda itu
  memang penghalang anti-spam.
- **Kerahasiaan data:** nomor & identitas responden tunduk pada kerahasiaan data BPS.
- **Berkas ekspor** memuat penanda identitas pengunduh dan menjadi tanggung jawabnya.

---

## Troubleshooting
| Masalah | Solusi |
|---|---|
| Login berhasil tapi kembali ke halaman login | Cookie sesi tidak tersimpan. Pastikan tidak memaksa `cookie.secure` bernilai `true` saat diakses lewat HTTP biasa — nilai `'auto'` menangani HTTP lokal maupun HTTPS tunnel. |
| `[FATAL] SESSION_SECRET belum diisi` | Salin `.env.example` ke `.env` lalu isi `SESSION_SECRET` dengan string acak ≥16 karakter. |
| `No such built-in module: node:sqlite` | Node terlalu lama. Perbarui ke Node 22.13+ / 24 dari nodejs.org. |
| `Could not find Chrome ...` | Pastikan Chrome/Edge terpasang, atau set `CHROME_PATH`. Lihat bagian "Soal Browser". |
| `EPERM: operation not permitted` | Tutup editor/antivirus/OneDrive yang mengunci folder; pindahkan proyek ke `C:\` lalu ulangi. |
| QR tidak muncul | Lebarkan jendela terminal, atau lihat QR di dashboard. Jalankan ulang bila perlu. |
| "Gateway WA belum siap" | Tunggu status di topbar berubah hijau (`WA Gateway Aktif`). |
| Port 3000 dipakai | PowerShell: `$env:PORT=4000; npm start`. |
| PML tidak melihat data apa pun | Pastikan PML sudah didaftarkan ke kegiatan yang benar lewat **Kelola PML**. |
| Lupa password | Tidak ada pengiriman surel. Tautan reset hanya muncul di konsol server — hubungi Admin. |

---

## Untuk Pengguna Harian
Panduan langkah demi langkah bagi PML ada di **[PANDUAN-PML.md](PANDUAN-PML.md)**.
