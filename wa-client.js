/**
 * wa-client.js
 * ------------
 * Modul WhatsApp Gateway berbasis `whatsapp-web.js` (GRATIS, tanpa API berbayar).
 *
 * Tanggung jawab modul ini:
 *  1. Inisialisasi & menampilkan QR di TERMINAL (login "Perangkat Tertaut").
 *  2. Listener balasan responden -> update status di SQLite (Instant Feedback Loop).
 *  3. Fungsi blastPending() -> kirim pesan verifikasi ke semua responden PENDING
 *     dengan jeda acak (anti-blokir).
 *
 * Sesi login disimpan (LocalAuth) sehingga tidak perlu scan QR tiap kali start.
 */

const fs = require('fs');
const EventEmitter = require('events');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const db = require('./database');

let ready = false;      // status apakah gateway sudah siap dipakai
let lastQR = null;      // menyimpan QR terakhir agar bisa dikirim ke client web
const bus = new EventEmitter(); // penyalur event WA -> Socket.io (qr / ready / disconnected)

// -----------------------------------------------------------------------------
// DETEKSI BROWSER
// whatsapp-web.js butuh Chromium. Daripada mengunduh (sering diblokir jaringan
// kantor), kita pakai Chrome/Edge yang SUDAH terpasang di PC.
// Prioritas: variabel lingkungan CHROME_PATH -> Chrome -> Edge -> (bawaan puppeteer)
// -----------------------------------------------------------------------------
function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    // Google Chrome (Windows)
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    // Microsoft Edge (Windows) - hampir selalu ada di Windows 10/11
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/microsoft-edge',
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (_) { /* abaikan */ }
  }
  return undefined; // undefined = biarkan puppeteer memakai Chromium bawaannya (bila ada)
}

const browserPath = findBrowser();
if (browserPath) console.log(`[WA] Memakai browser: ${browserPath}`);
else console.log('[WA] Chrome/Edge tidak terdeteksi; memakai Chromium bawaan puppeteer (bila terpasang).');

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    executablePath: browserPath, // undefined -> puppeteer pilih sendiri
    protocolTimeout: 120000, // 2 menit; cegah error "Runtime.callFunctionOn timed out"
    // Argumen di bawah membuat Chromium jalan stabil di PC kantor / tanpa GUI.
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

// --- EVENTS SIKLUS HIDUP -----------------------------------------------------
client.on('qr', (qr) => {
  lastQR = qr;
  bus.emit('qr', qr); // kirim ke dashboard web (Socket.io)
  console.log('\n==================================================');
  console.log(' SCAN QR (bisa juga discan dari dashboard web):');
  console.log(' (WhatsApp > Perangkat Tertaut > Tautkan Perangkat)');
  console.log('==================================================\n');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  ready = true;
  lastQR = null;
  bus.emit('ready');
  console.log('\n[WA] ✅ Gateway SIAP. Anda bisa mulai mengirim blast dari dashboard.');
});

client.on('authenticated', () => console.log('[WA] Autentikasi berhasil, sesi tersimpan.'));

// Progres pemuatan WhatsApp Web (muncul SEBELUM "ready"). Membantu memastikan
// prosesnya berjalan, bukan macet. Pemuatan pertama bisa 1-3 menit, sabar ya.
client.on('loading_screen', (percent, message) => {
  console.log(`[WA] Memuat WhatsApp Web… ${percent}%  ${message || ''}`);
});
client.on('change_state', (state) => console.log(`[WA] Status koneksi: ${state}`));
client.on('auth_failure', (msg) => console.error('[WA] ❌ Autentikasi GAGAL:', msg));
client.on('disconnected', (reason) => {
  ready = false;
  bus.emit('disconnected', reason);
  console.warn('[WA] ⚠️  Terputus:', reason);
});

// --- LISTENER BALASAN (INTI "INSTANT FEEDBACK LOOP") -------------------------
// Sebagian versi whatsapp-web.js tidak selalu memicu event 'message', maka kita
// juga dengarkan 'message_create'. Untuk mencegah proses ganda, pakai penanda id.
const _sudahDiproses = new Set();

// Cek apakah string tampak seperti nomor HP Indonesia (62xxxxxxxxxx)
function isPhoneLike(n) {
  return /^62\d{7,13}$/.test(n);
}

// Terjemahkan pengirim (bisa @c.us ATAU @lid) menjadi nomor telepon asli.
// WhatsApp versi baru menyembunyikan nomor di balik @lid; kita coba beberapa cara.
async function resolvePhone(msg) {
  const raw = String(msg.from);

  // 1) Sudah berupa nomor biasa (@c.us)
  if (raw.endsWith('@c.us')) return db.normalizeNumber(raw.replace(/@c\.us$/, ''));

  // 2) Coba ambil dari data kontak (versi baru mengembalikan nomor asli di sini)
  try {
    const c = await msg.getContact();
    if (c && c.number) {
      const n = db.normalizeNumber(String(c.number));
      if (isPhoneLike(n)) return n;
    }
  } catch (_) { /* abaikan */ }

  // 3) Coba API pemetaan LID -> nomor (whatsapp-web.js versi baru saja)
  try {
    if (typeof client.getContactLidAndPhone === 'function') {
      const res = await client.getContactLidAndPhone([raw]);
      const pn = res && res[0] && (res[0].pn || res[0].phone);
      if (pn) {
        const n = db.normalizeNumber(String(pn).replace(/@c\.us$/, ''));
        if (isPhoneLike(n)) return n;
      }
    }
  } catch (_) { /* abaikan */ }

  // 4) Gagal -> kembalikan bentuk mentah (akan tampak sebagai ID @lid di log)
  return db.normalizeNumber(raw.replace(/@lid$/, '').replace(/@c\.us$/, ''));
}

async function handleIncoming(msg) {
  try {
    if (msg.fromMe) return;                                 // abaikan pesan sendiri
    if (msg.from.endsWith('@g.us') || msg.isStatus) return; // abaikan grup & status

    const body = (msg.body || '').trim();
    if (!body) return; // abaikan pesan tanpa teks (notifikasi sistem, reaksi, dll)

    // Cegah pemrosesan ganda: event 'message' & 'message_create' bisa memicu
    // pesan yang sama. Kunci gabungan (pengirim + waktu + isi) andal walau id beda.
    const key = `${msg.from}|${msg.timestamp}|${body}`;
    if (_sudahDiproses.has(key)) return;
    _sudahDiproses.add(key);
    if (_sudahDiproses.size > 3000) _sudahDiproses.clear(); // batasi memori

    // Terjemahkan pengirim (@c.us / @lid) ke nomor telepon asli, lalu cocokkan.
    const waId = await resolvePhone(msg);
    const row = db.findAwaitingByWa(waId);

    console.log(`[WA] 📩 Balasan "${body}" dari ${msg.from}  ->  nomor ${waId}`);

    if (!row) {
      console.log(`[WA]    (diabaikan: tidak ada responden berstatus TERKIRIM dengan nomor ${waId})`);
      return;
    }

    if (body === '1') {
      db.markReply(row.id, 'VALID', body);
      // Pancarkan ke dashboard agar muncul notifikasi seketika (real-time)
      bus.emit('balasan', { id: row.id, nama_usaha: row.nama_usaha, nama_petugas: row.nama_petugas, status: 'VALID' });
      await msg.reply('Terima kasih 🙏. Jawaban Anda (kunjungan VALID) telah kami catat.\n\nSalam, *BPS Kabupaten Karangasem*.');
      console.log(`[WA] ✔ VALID  dari ${row.nama_usaha} (${waId})`);
    } else if (body === '2') {
      db.markReply(row.id, 'FRAUD', body);
      bus.emit('balasan', { id: row.id, nama_usaha: row.nama_usaha, nama_petugas: row.nama_petugas, status: 'FRAUD' });
      await msg.reply('Terima kasih atas laporan Anda 🙏. Informasi ini akan kami tindak lanjuti.\n\nSalam, *BPS Kabupaten Karangasem*.');
      console.log(`[WA] ⚠ FRAUD  dari ${row.nama_usaha} (${waId})`);

      // === FITUR AUTO-TEGURAN (BAD COP) ===================================
      // Begitu responden mengonfirmasi FRAUD, sistem langsung menegur PPL/petugas
      // via WhatsApp agar mengunjungi ulang lokasi dalam 24 jam.
      // Dibungkus try/catch tersendiri agar kegagalan teguran TIDAK mengganggu
      // alur utama (graceful degradation).
      if (row.no_hp_petugas) {
        try {
          await sendPlain(row.no_hp_petugas, buildTeguran(row));
          console.log(`[AUTO-TEGURAN] Terkirim ke petugas ${row.nama_petugas} (${row.no_hp_petugas})`);
          bus.emit('teguran', { nama_usaha: row.nama_usaha, nama_petugas: row.nama_petugas });
        } catch (e) {
          console.error('[AUTO-TEGURAN] Gagal mengirim teguran:', e.message);
        }
      } else {
        console.warn(`[AUTO-TEGURAN] Dilewati: no_hp_petugas kosong untuk ${row.nama_usaha}.`);
      }
      // ====================================================================
    } else {
      // FALLBACK: balasan bukan angka 1/2 -> minta ulang dengan format yang benar
      await msg.reply('Mohon maaf, sistem hanya mengenali angka. Mohon balas dengan angka *1* (YA) atau *2* (TIDAK).');
      console.log(`[WA]    (balasan "${body}" tidak dikenali, diminta ulang)`);
    }
  } catch (err) {
    console.error('[WA] Error saat memproses balasan:', err.message);
  }
}

client.on('message', handleIncoming);
client.on('message_create', handleIncoming);

// --- HELPER ------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** Susun isi pesan Auto-Teguran (Bad Cop) untuk PPL/petugas. */
function buildTeguran(row) {
  const survei = row.nama_survei || 'pendataan BPS';   // ISU 1: nama survei dari data, bukan hardcode
  return (
    `⚠️ *TEGURAN OTOMATIS — BPS Karangasem*\n\n` +
    `Yth. Saudara *${row.nama_petugas}*,\n\n` +
    `Responden *${row.nama_usaha}* pada kegiatan *${survei}* mengonfirmasi *TIDAK ada kunjungan fisik*.\n\n` +
    `Mohon segera *kunjungi ulang* lokasi tersebut dalam *1x24 jam* dan laporkan hasilnya kepada PML. ` +
    `Abaikan pesan ini bila kunjungan sudah dilakukan dan segera koordinasi dengan PML.\n\n` +
    `Pesan otomatis dari SWARA — Sistem WhatsApp Responsif & Akurat.`
  );
}

/** Kirim pesan ke SATU nomor bebas (dipakai Auto-Teguran & Daily Push).
 *  Menormalkan nomor lebih dulu. Melempar error bila WA belum siap. */
async function sendPlain(rawNumber, text) {
  if (!ready) throw new Error('Gateway WA belum siap.');
  const wa_id = db.normalizeNumber(rawNumber);
  if (!wa_id) throw new Error(`Nomor tujuan tidak valid: "${rawNumber}"`);
  return client.sendMessage(`${wa_id}@c.us`, text);
}

/** Susun isi pesan verifikasi untuk satu responden. */
function buildMessage(row) {
  const survei = row.nama_survei || 'pendataan BPS';   // ISU 1: dinamis per kegiatan
  return (
    `Halo dari *BPS Kabupaten Karangasem*.\n\n` +
    `Dalam rangka *${survei}*, apakah benar petugas *${row.nama_petugas}* telah ` +
    `mewawancarai Anda (usaha: *${row.nama_usaha}*) hari ini?\n\n` +
    `Balas *1* jika YA, balas *2* jika TIDAK.\n\n` +
    `Terima kasih atas partisipasi Anda. 🇮🇩`
  );
}

/**
 * Kirim pesan verifikasi ke sekumpulan responden (array baris DB).
 * @param {Array} rows daftar responden yang akan dikirimi
 * @param {number} minDelay jeda minimum antar pesan (ms)
 * @param {number} maxDelay jeda maksimum antar pesan (ms)
 */
async function _kirimBanyak(rows, minDelay, maxDelay) {
  let sukses = 0;
  let gagal = 0;
  for (const row of rows) {
    try {
      const chatId = `${row.wa_id}@c.us`;
      await client.sendMessage(chatId, buildMessage(row));
      db.markSent(row.id);
      sukses++;
      console.log(`[BLAST] → Terkirim ke ${row.nama_usaha} (${row.wa_id})`);
    } catch (err) {
      db.markFailed(row.id);
      gagal++;
      console.error(`[BLAST] ✖ Gagal ke ${row.wa_id}:`, err.message);
    }
    // Jeda acak anti-blokir
    await sleep(rand(minDelay, maxDelay));
  }
  bus.emit('blast-selesai', { total: rows.length, sukses, gagal });
  return { total: rows.length, sukses, gagal };
}

/**
 * Kirim ke SEMUA responden berstatus PENDING (jeda 6-15 detik).
 * @returns {Promise<{total:number, sukses:number, gagal:number}>}
 */
async function blastPending(rows) {
  if (!ready) throw new Error('Gateway WA belum siap. Scan QR terlebih dahulu.');
  // ISU 3: app.js mengirim baris yang SUDAH ter-scope (+nama_survei). Fallback ke global bila kosong.
  const target = Array.isArray(rows) ? rows : db.getPending();
  return _kirimBanyak(target, 6000, 15000);
}

/**
 * FITUR BARU: Kirim hanya ke responden TERPILIH (berdasarkan array id).
 * Hanya baris yang belum terjawab (PENDING/GAGAL) yang dikirim.
 * ATURAN ANTI-BANNED: jeda acak 5-8 detik antar pesan.
 * @param {number[]} ids
 */
async function blastByIds(ids, rowsScoped) {
  if (!ready) throw new Error('Gateway WA belum siap. Scan QR terlebih dahulu.');
  // ISU 3: pakai baris ter-scope dari app.js bila diberikan (mencegah blast lintas-PML)
  const src = Array.isArray(rowsScoped) ? rowsScoped : db.getByIds(ids);
  const rows = src.filter((r) => r.status === 'PENDING' || r.status === 'GAGAL');
  return _kirimBanyak(rows, 5000, 8000);
}

// --- INISIALISASI (dengan penanganan error sesi rusak) -----------------------
async function initWA() {
  try {
    await client.initialize();
  } catch (err) {
    console.error('\n[WA] ❌ Gagal inisialisasi WhatsApp:', err.message);
    console.error('[WA] Penyebab umum: sesi login rusak/kadaluarsa (mis. Anda logout dari HP,');
    console.error('     atau aplikasi dihentikan paksa saat sedang menautkan).');
    console.error('\n[WA] SOLUSI — hentikan proses (Ctrl+C), hapus folder sesi, lalu jalankan ulang:');
    console.error('     PowerShell:  Remove-Item -Recurse -Force .wwebjs_auth, .wwebjs_cache -ErrorAction SilentlyContinue');
    console.error('     lalu:        npm start');
    console.error('\n[WA] Catatan: data responden di data/audit.sqlite TIDAK terhapus, hanya sesi WA.\n');
  }
}

module.exports = {
  client,
  bus,
  initWA,
  isReady: () => ready,
  getLastQR: () => lastQR,
  blastPending,
  blastByIds,
  sendPlain,
};
