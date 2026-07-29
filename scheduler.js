/**
 * scheduler.js
 * ------------
 * ISU 5 — Daily Push stabil tiap pukul 17:00 WITA (Asia/Makassar).
 *  - Zona waktu dipatok eksplisit -> jam benar walau server UTC.
 *  - Ekspresi cron divalidasi saat start (cron.validate) -> gagal cepat bila salah.
 *  - Guard anti-tumpang-tindih: bila eksekusi sebelumnya belum selesai, dilewati.
 *  - recoverMissedExecutions:false -> tidak menembak ganda saat proses baru bangun.
 */

const cron = require('node-cron');
const db = require('./database');
const wa = require('./wa-client');

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

let sedangJalan = false; // guard anti-tumpang-tindih

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
}

module.exports = { startScheduler, buildDailySummary };
