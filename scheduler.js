/**
 * scheduler.js
 * ------------
 * FITUR "Daily Push Notification".
 * Cron job (default tiap hari pukul 17:00 WITA) mengirim ringkasan statistik
 * hari ini ke nomor PML/Supervisor (SUPERVISOR_PHONE di .env) via WhatsApp.
 *
 * Graceful degradation: bila WA belum siap atau nomor PML kosong, job dilewati
 * tanpa membuat aplikasi error.
 */

const cron = require('node-cron');
const db = require('./database');
const wa = require('./wa-client');

/** Susun teks ringkasan harian. */
function buildDailySummary() {
  const s = db.getStatsToday();
  const daftarFraud = s.fraudList.length
    ? s.fraudList.map((f) => `#${f.id} ${f.nama_usaha}`).join(', ')
    : '-';
  return (
    `📊 *Laporan Harian SE2026 — BPS Karangasem*\n\n` +
    `Tanggal: ${new Date().toLocaleDateString('id-ID')}\n` +
    `✅ Valid: *${s.valid}*\n` +
    `⚠️ Indikasi Fraud: *${s.fraud}*\n` +
    `ID Fraud: ${daftarFraud}\n\n` +
    `Mohon PML menindaklanjuti indikasi fraud di atas. Terima kasih.`
  );
}

/** Aktifkan penjadwalan. Dipanggil sekali dari app.js. */
function startScheduler() {
  const jadwal = process.env.DAILY_PUSH_CRON || '0 17 * * *'; // menit jam * * *
  const tz = process.env.CRON_TIMEZONE || 'Asia/Makassar'; // Bali = WITA
  const supervisor = process.env.SUPERVISOR_PHONE;

  cron.schedule(
    jadwal,
    async () => {
      console.log('[CRON] Menjalankan Daily Push…');
      if (!supervisor) return console.warn('[CRON] Dilewati: SUPERVISOR_PHONE belum diisi di .env.');
      if (!wa.isReady()) return console.warn('[CRON] Dilewati: WhatsApp Gateway belum siap.');
      try {
        await wa.sendPlain(supervisor, buildDailySummary());
        console.log('[CRON] ✅ Daily Push terkirim ke PML.');
      } catch (e) {
        console.error('[CRON] Gagal mengirim Daily Push:', e.message);
      }
    },
    { timezone: tz }
  );

  console.log(`[CRON] Daily Push dijadwalkan '${jadwal}' (zona ${tz}).`);
}

module.exports = { startScheduler, buildDailySummary };
