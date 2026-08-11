@echo off
REM ===========================================================================
REM  SWARA - Sistem WhatsApp Responsif & Akurat (BPS Kabupaten Karangasem)
REM ---------------------------------------------------------------------------
REM  Menjalankan server dan MENGHIDUPKANNYA KEMBALI secara otomatis bila proses
REM  berhenti (crash, Node ditutup, listrik sempat padam lalu PC menyala lagi).
REM
REM  Tanpa berkas ini, SWARA mati diam-diam: tidak ada yang tahu sampai ada yang
REM  sadar dashboard tak bisa dibuka. Padahal nilai sistem ini justru pada
REM  balasan responden yang masuk seketika.
REM
REM  CARA PAKAI
REM   1) Klik dua kali berkas ini untuk menjalankan secara manual, ATAU
REM   2) Jalankan otomatis saat komputer menyala:
REM        - Buka "Task Scheduler" (Penjadwal Tugas)
REM        - Create Task... -> tab General: centang "Run whether user is
REM          logged on or not" bila ingin jalan tanpa perlu login
REM        - tab Triggers  : New... -> Begin the task: "At log on"
REM        - tab Actions   : New... -> Program/script: berkas ini
REM                          (start-swara.bat), Start in: folder aplikasi
REM        - tab Settings  : hilangkan centang "Stop the task if it runs
REM                          longer than..." supaya tidak dimatikan sendiri
REM
REM  Catatan: pemindaian QR WhatsApp hanya diperlukan sekali. Sesi tersimpan di
REM  folder .wwebjs_auth sehingga proses yang menyala ulang langsung tersambung.
REM
REM  Log dituliskan ke data\swara.log (lihat berkas itu bila ada masalah).
REM ===========================================================================

title SWARA - BPS Karangasem
cd /d "%~dp0"

if not exist "data" mkdir "data"

echo ============================================================
echo  SWARA sedang dijalankan.
echo  Jangan tutup jendela ini selama sistem dipakai.
echo  Log lengkap: data\swara.log
echo ============================================================
echo.

:jalankan
echo [%date% %time%] SWARA dijalankan. >> "data\swara.log"
node app.js >> "data\swara.log" 2>&1

REM Sampai di sini berarti proses berhenti. Coba lagi setelah jeda singkat.
echo [%date% %time%] SWARA berhenti (kode %errorlevel%). Menjalankan ulang dalam 10 detik... >> "data\swara.log"
echo.
echo  [!] SWARA berhenti. Menjalankan ulang dalam 10 detik...
echo      Tekan Ctrl+C lalu Y bila memang ingin menghentikannya.
echo.
timeout /t 10 /nobreak >nul
goto jalankan
