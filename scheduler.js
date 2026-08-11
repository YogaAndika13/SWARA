/**
 * scheduler.js
 * ------------
 * ISU 5 — Daily Push stabil tiap pukul 17:00 WITA (Asia/Makassar).
 *  - Zona waktu dipatok eksplisit -> jam benar walau server UTC.
 *  - Ekspresi cron divalidasi saat start (cron.validate) -> gagal cepat bila salah.
 *  - Guard anti-tumpang-tindih: bila eksekusi sebelumnya belum selesai, dilewati.
 *  - recoverMissedExecutions:false -> tidak menembak ganda saat proses baru bangun.
 */

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const db = require('./database');
const wa = require('./wa-client');

// =============================================================================
// CADANGAN BASIS DATA
// data/audit.sqlite adalah SATU-SATUNYA salinan seluruh data responden, akun,
// dan jejak audit. Tanpa cadangan, satu berkas rusak = seluruh riwayat hilang.
// VACUUM INTO dipilih karena menghasilkan salinan yang konsisten walau server
// sedang melayani permintaan (aman untuk mode WAL), tanpa pustaka tambahan.
// =============================================================================
const DIR_BACKUP = path.join(__dirname, 'data', 'backup');

function jalankanBackup(simpanBerapaHari = 14) {
  fs.mkdirSync(DIR_BACKUP, { recursive: true });
  // Tanggal WITA supaya nama berkas cocok dengan hari kerja setempat
  const tgl = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Makassar' }); // YYYY-MM-DD
  const tujuan = path.join(DIR_BACKUP, `audit-${tgl}.sqlite`);

  // VACUUM INTO menolak menimpa berkas yang sudah ada -> hapus dulu bila ada
  if (fs.existsSync(tujuan)) fs.rmSync(tujuan);
  db.db.exec(`VACUUM INTO '${tujuan.replace(/'/g, "''")}'`);

  // Buang cadangan lama agar tidak memenuhi disk PC kantor
  const lama = fs.readdirSync(DIR_BACKUP)
    .filter((f) => /^audit-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f))
    .sort();
  const dibuang = lama.slice(0, Math.max(0, lama.length - simpanBerapaHari));
  for (const f of dibuang) fs.rmSync(path.join(DIR_BACKUP, f));

  const ukuranKb = Math.round(fs.statSync(tujuan).size / 1024);
  return { berkas: tujuan, ukuranKb, dibuang: dibuang.length, tersimpan: lama.length - dibuang.length };
}

/** Ringkasan harian (bisa difilter kegiatan bila diberikan scope). */
function buildDailySummary(scope) {
  const s = scope ? db.getStatsScoped(scope) : db.getStatsToday();
  const valid = s.valid ?? 0;
  const fraud = s.fraud ?? 0;
  const tgl = new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Makassar' });
  return (
    `📊 *Laporan Harian SWARA — BPS Karangasem*\n\n` +
    `Tanggal: ${tgl}\n` +
    `✅ Valid: *${valid}*\n` +
    `⚠️ Indikasi Fraud: *${fraud}*\n\n` +
    `Mohon PML menindaklanjuti indikasi fraud di atas. Terima kasih.`
  );
}

let sedangJalan = false; // guard anti-tumpang-tindih (Daily Push)
let backupJalan = false; // guard anti-tumpang-tindih (cadangan basis data)

function startScheduler() {
  const jadwal = process.env.DAILY_PUSH_CRON || '0 17 * * *'; // default 17:00
  const tz = process.env.CRON_TIMEZONE || 'Asia/Makassar';   // WITA
  const supervisor = process.env.SUPERVISOR_PHONE;

  // ISU 5: validasi ekspresi cron -> hindari job diam-diam tak jalan
  if (!cron.validate(jadwal)) {
    console.error(`[CRON] Ekspresi cron tidak valid: "${jadwal}". Daily Push TIDAK dijadwalkan.`);
    return;
  }

  cron.schedule(
    jadwal,
    async () => {
      if (sedangJalan) return console.warn('[CRON] Eksekusi sebelumnya belum selesai — dilewati.');
      sedangJalan = true;
      try {
        console.log('[CRON] Menjalankan Daily Push…');
        if (!supervisor) return console.warn('[CRON] Dilewati: SUPERVISOR_PHONE belum diisi di .env.');
        if (!wa.isReady()) return console.warn('[CRON] Dilewati: WhatsApp Gateway belum siap.');
        await wa.sendPlain(supervisor, buildDailySummary());
        console.log('[CRON] ✅ Daily Push terkirim ke PML.');
      } catch (e) {
        console.error('[CRON] Gagal mengirim Daily Push:', e.message);
      } finally {
        sedangJalan = false; // selalu dilepas, sukses maupun gagal
      }
    },
    { timezone: tz, recoverMissedExecutions: false }
  );

  console.log(`[CRON] Daily Push dijadwalkan '${jadwal}' zona ${tz} (stabil, tervalidasi).`);

  // --- Cadangan basis data harian (pola sama: validasi + guard) --------------
  const jadwalBackup = process.env.BACKUP_CRON || '0 2 * * *'; // default 02:00
  const simpan = Number(process.env.BACKUP_KEEP) || 14;        // simpan 14 hari
  if (!cron.validate(jadwalBackup)) {
    console.error(`[BACKUP] Ekspresi cron tidak valid: "${jadwalBackup}". Cadangan TIDAK dijadwalkan.`);
    return;
  }
  cron.schedule(
    jadwalBackup,
    () => {
      if (backupJalan) return console.warn('[BACKUP] Eksekusi sebelumnya belum selesai — dilewati.');
      backupJalan = true;
      try {
        const h = jalankanBackup(simpan);
        console.log(`[BACKUP] ✅ ${path.basename(h.berkas)} (${h.ukuranKb} KB) — tersimpan ${h.tersimpan}, dibuang ${h.dibuang}.`);
      } catch (e) {
        // Gagal mencadangkan tidak boleh menjatuhkan proses utama
        console.error('[BACKUP] Gagal membuat cadangan:', e.message);
      } finally {
        backupJalan = false;
      }
    },
    { timezone: tz, recoverMissedExecutions: false }
  );
  console.log(`[BACKUP] Cadangan basis data dijadwalkan '${jadwalBackup}' zona ${tz}, disimpan ${simpan} hari.`);
}

module.exports = { startScheduler, buildDailySummary, jalankanBackup };
