@echo off
REM ===========================================================================
REM  SWARA + Cloudflare Tunnel (BPS Kabupaten Karangasem)
REM ---------------------------------------------------------------------------
REM  Berkas ini menjalankan DUA hal sekaligus:
REM
REM    1) Terowongan Cloudflare - supaya SWARA dapat dibuka dari LUAR kantor
REM       (HP PML dengan paket data), lewat HTTPS, TANPA IP publik dan TANPA
REM       mengubah pengaturan router. Sambungannya keluar dari komputer ini,
REM       jadi tidak ada port yang perlu dibuka ke internet.
REM
REM    2) Server SWARA - persis seperti start-swara.bat, lengkap dengan
REM       penyalaan ulang otomatis bila proses berhenti.
REM
REM  KAPAN MEMAKAI YANG MANA
REM    - start-swara.bat        : semua pengguna berada di jaringan kantor.
REM    - start-swara-tunnel.bat : ada PML yang mengakses dari lapangan.
REM
REM  PERSIAPAN (SEKALI SAJA, di komputer server, jalankan sebagai Administrator)
REM       winget install Cloudflare.cloudflared
REM       cloudflared tunnel login
REM       cloudflared tunnel create swara
REM       cloudflared tunnel route dns swara swara.^<domain-anda^>
REM    Lalu pastikan TUNNEL_NAME di bawah sama dengan nama tunnel yang dibuat.
REM
REM  BELUM PUNYA DOMAIN?
REM    Kosongkan TUNNEL_NAME menjadi  set "TUNNEL_NAME="  - Cloudflare memberi
REM    alamat *.trycloudflare.com gratis. TETAPI alamat itu BERGANTI setiap kali
REM    dijalankan ulang, sehingga PML harus diberi alamat baru setiap pagi.
REM    Cukup untuk uji coba, TIDAK layak untuk pemakaian sehari-hari.
REM
REM  ALAMAT PUBLIKNYA DI MANA?
REM    Lihat berkas  data\tunnel.log  (baris yang memuat https://...).
REM
REM  MENGHENTIKAN
REM    Tutup KEDUA jendela: jendela ini DAN jendela berjudul
REM    "Cloudflare Tunnel - SWARA". Menutup salah satu saja menyisakan yang lain
REM    tetap berjalan. Jangan menjalankan berkas ini dua kali - akan ada dua
REM    terowongan yang saling berebut.
REM
REM  KEAMANAN
REM    Begitu alamat publik hidup, halaman login SWARA terbuka bagi siapa pun
REM    yang tahu alamatnya. Sangat dianjurkan memasang Cloudflare Access
REM    (gratis s.d. 50 pengguna) di depan alamat itu, sehingga hanya surel yang
REM    didaftarkan yang boleh sampai ke halaman login.
REM ===========================================================================

title SWARA + Tunnel - BPS Karangasem
cd /d "%~dp0"

REM --- Nama tunnel bernama. Kosongkan untuk memakai quick tunnel sementara. ---
set "TUNNEL_NAME="

if not exist "data" mkdir "data"

REM --- Ambil PORT dari .env; bila tidak ada, pakai 3000 ------------------------
set "PORT=3000"
if exist ".env" (
  for /f "usebackq tokens=2 delims==" %%A in (`findstr /b /i "PORT=" ".env"`) do set "PORT=%%A"
)

REM --- Pastikan cloudflared tersedia ------------------------------------------
where cloudflared >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [X] cloudflared tidak ditemukan.
  echo.
  echo      Pasang lebih dulu lewat PowerShell sebagai Administrator:
  echo          winget install Cloudflare.cloudflared
  echo.
  echo      Bila hanya perlu akses dari jaringan kantor, pakai start-swara.bat.
  echo.
  pause
  exit /b 1
)

echo ============================================================
echo  SWARA sedang dijalankan beserta terowongan Cloudflare.
echo  Jangan tutup jendela ini selama sistem dipakai.
echo.
echo  Log server    : data\swara.log
echo  Log terowongan: data\tunnel.log  ^<-- alamat publik ada di sini
echo ============================================================
echo.

REM --- Jalankan terowongan di jendela terpisah --------------------------------
echo [%date% %time%] Terowongan dijalankan. >> "data\tunnel.log"
if defined TUNNEL_NAME (
  echo  [1/2] Menjalankan terowongan "%TUNNEL_NAME%" -^> http://localhost:%PORT%
  start "Cloudflare Tunnel - SWARA" /min cmd /c "cloudflared tunnel run --url http://localhost:%PORT% %TUNNEL_NAME% >> data\tunnel.log 2>&1"
) else (
  echo  [1/2] Menjalankan terowongan SEMENTARA ^(alamat berganti tiap restart^)
  start "Cloudflare Tunnel - SWARA" /min cmd /c "cloudflared tunnel --url http://localhost:%PORT% >> data\tunnel.log 2>&1"
)

REM Beri jeda agar terowongan sempat tersambung sebelum server menyala.
timeout /t 5 /nobreak >nul
echo  [2/2] Menjalankan server SWARA di port %PORT%
echo.

:jalankan
echo [%date% %time%] SWARA dijalankan. >> "data\swara.log"
node app.js >> "data\swara.log" 2>&1

REM Sampai di sini berarti proses berhenti. Coba lagi setelah jeda singkat.
REM Terowongan dibiarkan hidup - ia menyambung sendiri saat server kembali naik.
echo [%date% %time%] SWARA berhenti (kode %errorlevel%). Menjalankan ulang dalam 10 detik... >> "data\swara.log"
echo.
echo  [!] SWARA berhenti. Menjalankan ulang dalam 10 detik...
echo      Tekan Ctrl+C lalu Y bila memang ingin menghentikannya.
echo      Ingat: tutup juga jendela "Cloudflare Tunnel - SWARA".
echo.
timeout /t 10 /nobreak >nul
goto jalankan
