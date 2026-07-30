/**
 * app.js
 * ------
 * Server utama (Express). Menyatukan tiga hal:
 *  1. Menyajikan halaman Dashboard (views/dashboard.html).
 *  2. API JSON untuk data (statistik & daftar responden) yang dibaca Alpine.js.
 *  3. Aksi: upload CSV, tambah manual, dan memicu blast WhatsApp.
 *
 * Jalankan: `npm start` lalu buka http://localhost:3000
 */

// Muat variabel .env SEBELUM modul lain membacanya
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const session = require('express-session');

const db = require('./database');
const wa = require('./wa-client');
const passport = require('./config/passport');
const authRoutes = require('./routes/auth');
const { ensurePage, ensureApi, requireRole, attachScope } = require('./middleware/auth'); // ISU 4
const scheduler = require('./scheduler');

// --- GUARD: pastikan middleware/auth.js versi terbaru sudah terpasang --------
if (typeof ensurePage !== 'function' || typeof ensureApi !== 'function') {
  console.error('\n============================================================');
  console.error('[FATAL] middleware/auth.js versi LAMA/kosong terdeteksi.');
  console.error('        (fungsi ensurePage / ensureApi tidak ditemukan)');
  console.error('        SOLUSI: timpa file middleware/auth.js dengan versi');
  console.error('        TERBARU, lalu jalankan ulang: npm start');
  console.error('============================================================\n');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// --- SELF-CHECK: pastikan database.js versi terbaru sudah terpasang ----------
// Bila file database.js masih versi lama, beri pesan yang jelas & actionable.
(() => {
  const wajib = ['findUserByEmail', 'createUser', 'getStatsToday', 'resolveManual'];
  const hilang = wajib.filter((fn) => typeof db[fn] !== 'function');
  if (hilang.length) {
    console.error('\n============================================================');
    console.error('[FATAL] database.js versi LAMA terdeteksi.');
    console.error(`        Fungsi belum ada: ${hilang.join(', ')}`);
    console.error('        SOLUSI: timpa file database.js dengan versi TERBARU,');
    console.error('        lalu jalankan ulang: npm start');
    console.error('============================================================\n');
  }
})();

// --- SEED: buat akun admin default bila belum ada (memudahkan login pertama) --
try {
  const bcrypt = require('bcryptjs');
  if (typeof db.findUserByEmail === 'function' && !db.findUserByEmail('admin@bps.go.id')) {
    db.createUser({
      nama: 'Administrator BPS',
      role: 'Admin', // ISU 4: akun default = Admin (akses penuh semua data & survei)
      email: 'admin@bps.go.id',
      password: bcrypt.hashSync('bps12345', 10),
    });
    console.log('[SEED] Akun default dibuat -> email: admin@bps.go.id | password: bps12345');
  }
} catch (e) {
  console.error('[SEED] Dilewati:', e.message);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- SESSION & PASSPORT ------------------------------------------------------
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'rahasia-dev-harap-ganti-di-produksi',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }, // sesi 8 jam
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Rute autentikasi (PUBLIK): /login, /signup, /forgot, /auth/google, /logout, dll
app.use('/', authRoutes);

// Konfigurasi upload sementara (file CSV masuk ke folder /uploads lalu dihapus)
const upload = multer({ dest: path.join(__dirname, 'uploads') });

// -----------------------------------------------------------------------------
// HALAMAN DASHBOARD (DILINDUNGI — wajib login)
// -----------------------------------------------------------------------------
app.get('/', ensurePage, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// -----------------------------------------------------------------------------
// PROTEKSI SEMUA ENDPOINT /api (wajib login) — Graceful: balas 401 JSON
// -----------------------------------------------------------------------------
app.use('/api', ensureApi);
// ISU 3: setiap request /api otomatis punya req.scope { id_kegiatan, pml_id }
app.use('/api', attachScope(db));

// =============================================================================
// MITIGASI ISU 1 — PAKTA INTEGRITAS KERAHASIAAN DATA
// Pengguna WAJIB menyetujui pernyataan kerahasiaan sebelum dapat mengakses data.
// Versi pakta disimpan; bila naskah diperbarui, persetujuan diminta ulang.
// =============================================================================
const PAKTA_VERSI = '1.0';

// Helper: identitas pemakai + IP untuk pencatatan audit
const jejak = (req) => ({
  user_email: (req.user && req.user.email) || '(anonim)',
  ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
});

// Status pakta pengguna saat ini
app.get('/api/pakta', (req, res) => {
  const u = req.user || {};
  res.json({ versi: PAKTA_VERSI, disetujui: u.pakta_versi === PAKTA_VERSI, waktu: u.pakta_at || null });
});

// Menyetujui pakta (dicatat di audit trail)
app.post('/api/pakta', (req, res) => {
  if (!req.body || req.body.setuju !== true) {
    return res.status(400).json({ error: 'Persetujuan wajib dicentang untuk melanjutkan.' });
  }
  db.acceptPakta(req.user.id, PAKTA_VERSI);
  db.logAudit({ ...jejak(req), aksi: 'SETUJU_PAKTA', detail: `Pakta Integritas v${PAKTA_VERSI}` });
  res.json({ ok: true });
});

// Gerbang: semua endpoint data DI BAWAH baris ini butuh pakta yang sudah disetujui.
// Dikecualikan: /api/me, /api/pakta, /api/wa-status (tidak memuat data rahasia).
app.use('/api', (req, res, next) => {
  const bebas = ['/me', '/pakta', '/wa-status'];
  if (bebas.includes(req.path)) return next();
  const u = req.user || {};
  if (u.pakta_versi !== PAKTA_VERSI) {
    return res.status(403).json({
      error: 'Anda belum menyetujui Pakta Integritas Kerahasiaan Data.',
      butuh_pakta: true,
    });
  }
  next();
});

// Info user yang sedang login (untuk header dashboard)
app.get('/api/me', (req, res) => {
  const u = req.user || {};
  // ISU 1+4: kirim role & kegiatan aktif agar dashboard menyesuaikan tampilan
  res.json({ nama: u.nama, email: u.email, role: u.role || 'PML', scope: req.scope });
});

// ISU 1: daftar kegiatan untuk pemilih di dashboard.
// PML hanya melihat kegiatan yang ia ikuti; Admin melihat semua.
app.get('/api/kegiatan', (req, res) => res.json(db.listKegiatanForUser(req.user)));
// Admin dapat menambah kegiatan baru
app.post('/api/kegiatan', requireRole('Admin'), (req, res) => {
  try {
    const { kode, nama } = req.body || {};
    if (!kode || !nama) return res.status(400).json({ error: 'Kode dan nama kegiatan wajib diisi.' });
    const id = db.createKegiatan({ kode, nama });
    res.status(201).json({ ok: true, id });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// --- KELOLA KEANGGOTAAN PML (khusus Admin) ---
// Daftar PML beserta kegiatan yang diikutinya
app.get('/api/pml', requireRole('Admin'), (req, res) => res.json(db.listPmlDenganKegiatan()));
// Daftarkan / keluarkan PML dari sebuah kegiatan
app.post('/api/pml/:id/kegiatan', requireRole('Admin'), (req, res) => {
  const pmlId = Number(req.params.id);
  const idKeg = Number(req.body && req.body.id_kegiatan);
  const aksi = (req.body && req.body.aksi) || 'tambah';
  if (!pmlId || !idKeg) return res.status(400).json({ error: 'pml_id dan id_kegiatan wajib.' });
  if (aksi === 'hapus') db.keluarkanPml(pmlId, idKeg);
  else db.daftarkanPml(pmlId, idKeg);
  db.logAudit({ ...jejak(req), aksi: 'KELOLA_PML', detail: `${aksi} PML#${pmlId} @kegiatan#${idKeg}`, jumlah: 1 });
  res.json({ ok: true, kegiatan: db.getKegiatanIdsForPml(pmlId) });
});

// -----------------------------------------------------------------------------
// API: DATA (dibaca oleh Alpine.js secara berkala)
// -----------------------------------------------------------------------------
app.get('/api/stats', (req, res) => res.json(db.getStatsScoped(req.scope))); // ISU 3
// MITIGASI ISU 1: nomor HP dikirim ke browser dalam bentuk TER-MASKING.
// Nomor lengkap tidak pernah keluar dari server kecuali lewat aksi eksplisit
// pada endpoint /api/reveal/:id yang selalu dicatat di audit trail.
app.get('/api/responden', (req, res) => res.json(db.getAllScoped(req.scope).map(db.toSafeRow))); // ISU 3

// Buka nomor lengkap SATU baris (aksi sadar & tercatat)
app.get('/api/reveal/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.getByIdScoped(id, req.scope);   // ISU 3: hanya bila milik scope ini
  if (!row) return res.status(404).json({ error: 'Data tidak ditemukan.' });
  if (row.anonim_at) return res.status(410).json({ error: 'Nomor sudah dimusnahkan sesuai kebijakan retensi.' });
  db.logAudit({ ...jejak(req), aksi: 'BUKA_NOMOR', detail: `#${id} ${row.nama_usaha}`, jumlah: 1 });
  res.json({ id, no_hp: row.no_hp, no_hp_petugas: row.no_hp_petugas });
});

// Audit trail (jejak akses data) — transparansi bagi pengawas
// Jejak audit = alat pengawasan -> KHUSUS Admin (Bug: PML tak boleh lihat)
app.get('/api/audit-log', requireRole('Admin'), (req, res) => res.json(db.getAuditLog(req.query.limit || 100)));

// MITIGASI ISU 2: rekap provenance (asal-usul) data
app.get('/api/rekap-sumber', (req, res) => res.json(db.getRekapSumber()));

// MITIGASI ISU 2: pilih sampel acak dari data PENDING (bila kerangka tak lengkap)
app.post('/api/sample', (req, res) => {
  const n = Number(req.body && req.body.jumlah) || 10;
  const ids = db.getSampleIds(n);
  db.logAudit({ ...jejak(req), aksi: 'PILIH_SAMPEL', detail: `sampel acak ${ids.length} baris`, jumlah: ids.length });
  res.json({ ok: true, ids, jumlah: ids.length });
});

// MITIGASI ISU 1: pemusnahan nomor sesuai kebijakan retensi
app.post('/api/purge', (req, res) => {
  const hari = req.body && req.body.hari !== undefined ? Number(req.body.hari) : 30;
  const n = db.purgeNomorLama(hari);
  db.logAudit({ ...jejak(req), aksi: 'MUSNAHKAN_NOMOR', detail: `retensi ${hari} hari`, jumlah: n });
  res.json({ ok: true, jumlah: n, message: `${n} nomor telah dimusnahkan (retensi ${hari} hari).` });
});
app.get('/api/wa-status', (req, res) => res.json({ ready: wa.isReady() }));

// -----------------------------------------------------------------------------
// API: TAMBAH SATU RESPONDEN (manual via form JSON)
// -----------------------------------------------------------------------------
app.post('/api/responden', (req, res) => {
  try {
    const { nama_usaha, no_hp, nama_petugas, no_hp_petugas, sumber_data } = req.body;
    if (!nama_usaha || !no_hp || !nama_petugas) {
      return res.status(400).json({ error: 'Nama usaha, No HP, dan Nama petugas wajib diisi.' });
    }
    // ISU 1+3: data baru otomatis terikat ke kegiatan aktif & PML pembuatnya
    const id = db.insertResponden({
      nama_usaha, no_hp, nama_petugas, no_hp_petugas, sumber_data,
      id_kegiatan: req.scope.id_kegiatan,
      pml_id: req.user.id,
    });
    db.logAudit({ ...jejak(req), aksi: 'TAMBAH_DATA', detail: `#${id} ${nama_usaha} (${sumber_data || 'MANUAL_PML'})`, jumlah: 1 });
    res.json({ ok: true, id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// API: UPLOAD CSV
// Header CSV yang dikenali: nama_usaha, no_hp, nama_petugas
// (kolom alternatif juga didukung: usaha / hp / nomor / petugas)
// -----------------------------------------------------------------------------
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File CSV wajib diupload.' });

  try {
    const content = fs.readFileSync(req.file.path);
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true, // toleran terhadap file dari Excel (BOM)
    });

    let ok = 0;
    let skip = 0;
    const errors = [];

    for (const r of records) {
      // Normalisasi nama kolom -> huruf kecil, agar header UPPERCASE (template) juga terbaca
      const low = {};
      for (const k in r) low[String(k).toLowerCase().trim()] = r[k];

      const nama_usaha = low.nama_usaha || low.usaha || low.nama || '';
      const no_hp = low.no_hp || low.hp || low.nomor || low.telepon || '';
      const nama_petugas = low.nama_petugas || low.petugas || '';
      // OPSIONAL: nomor HP petugas (untuk Auto-Teguran)
      const no_hp_petugas = low.no_hp_petugas || low.hp_petugas || low.petugas_hp || '';
      // MITIGASI ISU 2: asal data per baris. Prioritas: kolom CSV -> pilihan di form -> default
      const sumber_data =
        String(low.sumber_data || low.sumber || req.body.sumber_data || 'MANUAL_PML').toUpperCase().trim();

      if (!nama_usaha || !no_hp || !nama_petugas) {
        skip++;
        continue;
      }
      try {
        db.insertResponden({
          nama_usaha, no_hp, nama_petugas, no_hp_petugas, sumber_data,
          id_kegiatan: req.scope.id_kegiatan,   // ISU 1
          pml_id: req.user.id,                  // ISU 3
        });
        ok++;
      } catch (e) {
        skip++;
        errors.push(e.message);
      }
    }

    db.logAudit({
      ...jejak(req),
      aksi: 'IMPOR_DATA',
      detail: `CSV "${req.file.originalname || 'tanpa nama'}" (${ok} masuk, ${skip} dilewati)`,
      jumlah: ok,
    });
    res.json({ ok, skip, total: records.length, errors: errors.slice(0, 5) });
  } catch (err) {
    res.status(400).json({ error: 'Gagal membaca CSV: ' + err.message });
  } finally {
    // Bersihkan file sementara
    fs.unlink(req.file.path, () => {});
  }
});

// -----------------------------------------------------------------------------
// API: BLAST (fire-and-forget)
// Mengembalikan respons langsung; progres tercermin di tabel saat status berubah.
// -----------------------------------------------------------------------------
app.post('/api/blast', (req, res) => {
  const siap = wa.isReady();
  const pendingScoped = db.getPendingScoped(req.scope);   // ISU 3: hanya data dalam scope
  const jumlah = pendingScoped.length;
  console.log(`\n[BLAST] Tombol ditekan. Gateway siap = ${siap} | Responden PENDING = ${jumlah}`);

  if (!siap) {
    console.log('[BLAST] Dibatalkan: gateway WA belum siap (belum muncul "Gateway SIAP").');
    return res.status(400).json({ error: 'Gateway WA belum siap. Scan QR di terminal dulu (tunggu "Gateway SIAP").' });
  }

  if (jumlah === 0) {
    console.log('[BLAST] Dibatalkan: tidak ada responden berstatus PENDING.');
    return res.json({ ok: true, message: 'Tidak ada responden berstatus PENDING.' });
  }

  console.log(`[BLAST] Memulai pengiriman ke ${jumlah} responden…`);
  db.logAudit({ ...jejak(req), aksi: 'BLAST_SEMUA', detail: 'kirim verifikasi ke seluruh PENDING', jumlah });

  // Jalankan di background agar HTTP tidak menunggu (blast bisa lama karena jeda)
  wa.blastPending(pendingScoped)   // ISU 1+3: baris ter-scope + nama_survei
    .then((r) => console.log('[BLAST] Selesai:', r))
    .catch((e) => console.error('[BLAST] Error:', e.message));

  res.json({
    ok: true,
    message: `Blast dimulai untuk ${jumlah} responden. Pantau progres pada tabel di bawah.`,
  });
});

// -----------------------------------------------------------------------------
// API: RESET STATUS (untuk uji coba / kirim ulang)
// Mengembalikan responden ke status PENDING agar bisa di-blast lagi.
// Body opsional { id: <number> } untuk reset satu baris; tanpa id = reset semua.
// -----------------------------------------------------------------------------
app.post('/api/reset', (req, res) => {
  const { id } = req.body || {};
  const info = id ? db.resetOne(id) : db.resetAll();
  const n = Number(info.changes || 0);
  console.log(`[RESET] ${n} responden dikembalikan ke status PENDING.`);
  res.json({ ok: true, changes: n });
});

// -----------------------------------------------------------------------------
// FITUR 1: BLAST TERPILIH (throttling 5-8 detik diatur di wa-client.blastByIds)
// Body: { ids: [1,2,3] }
// -----------------------------------------------------------------------------
app.post('/api/blast-selected', (req, res) => {
  if (!wa.isReady()) {
    return res.status(400).json({ error: 'Gateway WA belum siap. Scan QR dulu.' });
  }
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  if (ids.length === 0) {
    return res.status(400).json({ error: 'Tidak ada responden yang dipilih.' });
  }
  // ISU 3: filter id ke scope milik user -> hanya datanya yang boleh dikirim
  const rowsScoped = db.getByIdsScoped(ids, req.scope);
  if (rowsScoped.length === 0) {
    return res.status(403).json({ error: 'Tidak ada data terpilih yang berada dalam wewenang Anda.' });
  }
  console.log(`[BLAST-SELECTED] Memulai pengiriman ke ${rowsScoped.length} responden terpilih…`);
  db.logAudit({ ...jejak(req), aksi: 'BLAST_TERPILIH', detail: `id: ${rowsScoped.map((r)=>r.id).slice(0, 20).join(',')}`, jumlah: rowsScoped.length });
  wa.blastByIds(ids, rowsScoped)
    .then((r) => console.log('[BLAST-SELECTED] Selesai:', r))
    .catch((e) => console.error('[BLAST-SELECTED] Error:', e.message));
  res.json({ ok: true, message: `Blast dimulai untuk ${ids.length} responden terpilih (jeda 5-8 detik/pesan).` });
});

// -----------------------------------------------------------------------------
// FITUR 7: VALIDASI MANUAL (ubah FRAUD -> VALID_MANUAL)
// -----------------------------------------------------------------------------
app.post('/api/resolve/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.getByIdScoped(id, req.scope)) return res.status(404).json({ error: 'Data tidak ditemukan.' }); // ISU 3
  const info = db.resolveManual(id);
  console.log(`[RESOLVE] Responden #${id} divalidasi manual menjadi VALID_MANUAL.`);
  db.logAudit({ ...jejak(req), aksi: 'VALIDASI_MANUAL', detail: `#${id} Fraud -> Valid (Manual)`, jumlah: 1 });
  res.json({ ok: true, changes: Number(info.changes || 0) });
});

// -----------------------------------------------------------------------------
// FITUR 2: TEMPLATE & EKSPOR CSV
// -----------------------------------------------------------------------------
// Bungkus sel CSV: beri tanda kutip bila mengandung koma / kutip / baris baru
function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(arr) {
  return arr.map(csvCell).join(',');
}

app.get('/api/download-template', (req, res) => {
  // \uFEFF (BOM) agar Excel membuka UTF-8 dengan benar
  // NO_HP_PETUGAS opsional (untuk fitur Auto-Teguran)
  // SUMBER_DATA (MITIGASI ISU 2): SQL_LAB | CAPI | MANUAL_PML | LAINNYA
  const csv = '\uFEFF' + [
    'NAMA_USAHA,NO_HP,PETUGAS,NO_HP_PETUGAS,SUMBER_DATA',
    'Contoh Usaha,08123456789,Nama Petugas,081200000000,MANUAL_PML',
  ].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="template.csv"');
  res.send(csv);
});

app.get('/api/export-report', (req, res) => {
  // MITIGASI ISU 1:
  //  (a) Default ekspor TER-MASKING. Nomor penuh hanya bila ?penuh=1 (tercatat di audit).
  //  (b) WATERMARK: identitas pengunduh + waktu ditanam di file, agar kebocoran terlacak.
  const penuh = req.query.penuh === '1';
  const rows = db.getAll();
  const j = jejak(req);

  const watermark =
    `# DOKUMEN RAHASIA - BPS Kabupaten Karangasem` +
    ` | Diunduh oleh: ${j.user_email}` +
    ` | Waktu: ${new Date().toLocaleString('id-ID')}` +
    ` | Mode: ${penuh ? 'NOMOR PENUH' : 'NOMOR TERSAMAR'}` +
    ` | Dilarang disebarluaskan (UU 16/1997 & UU 27/2022)`;

  const header = ['NAMA_USAHA', 'NO_HP', 'PETUGAS', 'STATUS', 'BALASAN', 'SUMBER_DATA', 'WAKTU_KIRIM', 'WAKTU_BALAS'];
  const lines = [csvRow([watermark]), csvRow(header)];
  for (const r of rows) {
    const nohp = r.anonim_at ? '[DIMUSNAHKAN]' : (penuh ? r.no_hp : db.maskNumber(r.no_hp));
    lines.push(csvRow([r.nama_usaha, nohp, r.nama_petugas, r.status, r.balasan, r.sumber_data, r.waktu_kirim, r.waktu_balas]));
  }

  db.logAudit({
    ...j,
    aksi: 'EKSPOR_DATA',
    detail: penuh ? 'CSV nomor PENUH' : 'CSV nomor tersamar',
    jumlah: rows.length,
  });

  const csv = '\uFEFF' + lines.join('\r\n');
  const tanggal = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="laporan_audit_se2026_${tanggal}.csv"`);
  res.send(csv);
});

// -----------------------------------------------------------------------------
// START
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// FITUR 6: SOCKET.IO — kirim QR & status WA ke dashboard web secara real-time
// -----------------------------------------------------------------------------
const server = http.createServer(app);
const io = new Server(server);

io.on('connection', (socket) => {
  // Saat client web terhubung, kirim keadaan terkini
  if (wa.isReady()) socket.emit('wa-ready');
  else if (wa.getLastQR()) socket.emit('wa-qr', wa.getLastQR());
});

// Teruskan event dari gateway WhatsApp ke semua client web
wa.bus.on('qr', (qr) => io.emit('wa-qr', qr));
wa.bus.on('ready', () => io.emit('wa-ready'));
wa.bus.on('disconnected', () => io.emit('wa-disconnected'));

// Notifikasi REAL-TIME ke dashboard: balasan responden, auto-teguran, blast selesai.
// Dashboard tak perlu menunggu penyegaran 5 detik — reaksi tampak seketika.
wa.bus.on('balasan', (d) => io.emit('balasan-baru', d));
wa.bus.on('teguran', (d) => io.emit('teguran-terkirim', d));
wa.bus.on('blast-selesai', (d) => io.emit('blast-selesai', d));

server.listen(PORT, () => {
  console.log('\n==================================================');
  console.log('  SWARA - Sistem WhatsApp Responsif & Akurat (BPS Karangasem)');
  console.log(`  Dashboard : http://localhost:${PORT}`);
  console.log('==================================================');
  console.log('[APP] Menginisialisasi WhatsApp Gateway…');
});

// Pengaman: jangan biarkan error tak tertangani (mis. dari proses WhatsApp)
// mematikan seluruh server. Cukup catat, biarkan dashboard tetap hidup.
process.on('unhandledRejection', (reason) => {
  console.error('[APP] Peringatan (unhandledRejection):', reason && reason.message ? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[APP] Peringatan (uncaughtException):', err && err.message ? err.message : err);
});

// Inisialisasi WhatsApp (QR akan muncul di terminal DAN di dashboard web)
wa.initWA();

// Aktifkan penjadwalan Daily Push Notification (17:00 ke PML)
scheduler.startScheduler();

// Diekspor agar dapat diuji secara otomatis (integration test)
module.exports = app;
