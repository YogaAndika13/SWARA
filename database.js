/**
 * database.js
 * -----------
 * Lapisan data (SQLite).
 *
 * PENTING: Modul ini memakai SQLite BAWAAN Node.js (`node:sqlite`), BUKAN
 * library eksternal. Tujuannya agar TIDAK perlu kompilasi (node-gyp/Python/
 * Visual Studio Build Tools) -> cocok untuk PC kantor tanpa tools tambahan.
 *
 * Syarat: Node.js versi 22.5+ (idealnya Node 24, di mana `node:sqlite` sudah
 * aktif tanpa flag tambahan). Cek versi Anda: `node -v`.
 *
 * API `node:sqlite` mirip better-sqlite3: prepare().run()/.get()/.all().
 * Di sini semua parameter memakai placeholder posisi ( ? ) agar sederhana.
 */

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// Pastikan folder penyimpanan DB ada
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'audit.sqlite'));
db.exec('PRAGMA journal_mode = WAL;'); // lebih tahan saat baca-tulis bersamaan

// -----------------------------------------------------------------------------
// SKEMA
// Status alur: PENDING -> TERKIRIM -> VALID / FRAUD   (atau GAGAL bila gagal kirim)
// -----------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS responden (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nama_usaha    TEXT    NOT NULL,
    no_hp         TEXT    NOT NULL,
    wa_id         TEXT    NOT NULL,
    nama_petugas  TEXT    NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'PENDING',
    balasan       TEXT,
    waktu_kirim   TEXT,
    waktu_balas   TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_responden_wa     ON responden(wa_id);
  CREATE INDEX IF NOT EXISTS idx_responden_status ON responden(status);
`);

// Migrasi ringan: tambah kolom no_hp_petugas bila belum ada.
// Dipakai fitur "Auto-Teguran" (kirim WA ke PPL saat responden balas FRAUD).
const _kolomResponden = db.prepare(`PRAGMA table_info(responden)`).all();
const _punyaKolom = (n) => _kolomResponden.some((k) => k.name === n);
if (!_punyaKolom('no_hp_petugas')) db.exec(`ALTER TABLE responden ADD COLUMN no_hp_petugas TEXT`);

// MITIGASI ISU 2 (source-agnostic): asal data dicatat per baris, sehingga sistem
// TIDAK bergantung pada satu sumber (SQL Lab).
// Nilai: SQL_LAB | CAPI | MANUAL_PML | LAINNYA
if (!_punyaKolom('sumber_data')) db.exec(`ALTER TABLE responden ADD COLUMN sumber_data TEXT DEFAULT 'MANUAL_PML'`);

// MITIGASI ISU 1 (kerahasiaan): penanda bahwa nomor telah dimusnahkan (retensi data)
if (!_punyaKolom('anonim_at')) db.exec(`ALTER TABLE responden ADD COLUMN anonim_at TEXT`);

// ISU 1 (Survey-Agnostic): master kegiatan/survei. Sistem tidak lagi terikat "SE2026".
db.exec(`
  CREATE TABLE IF NOT EXISTS kegiatan (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kode       TEXT UNIQUE NOT NULL,          -- mis. 'SE2026', 'SUSENAS2026'
    nama       TEXT NOT NULL,                 -- mis. 'Sensus Ekonomi 2026'
    aktif      INTEGER NOT NULL DEFAULT 1,    -- 1 = kegiatan berjalan
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);
// Seed satu kegiatan default bila kosong (agar data lama tetap punya induk)
const _adaKeg = db.prepare(`SELECT COUNT(*) c FROM kegiatan`).get().c;
if (!_adaKeg) db.prepare(`INSERT INTO kegiatan (kode, nama) VALUES (?, ?)`).run('UMUM', 'Kegiatan Pendataan BPS');

// Keanggotaan PML pada kegiatan (relasi many-to-many). PML hanya bisa berpindah
// ke kegiatan yang tercatat di sini (tempat ia "didaftarkan").
db.exec(`
  CREATE TABLE IF NOT EXISTS pml_kegiatan (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    pml_id      INTEGER NOT NULL,
    id_kegiatan INTEGER NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(pml_id, id_kegiatan)
  );
`);
// Migrasi mulus (agar PML lama tidak terkunci saat upgrade):
//  (a) pindahkan kolom users.id_kegiatan lama -> keanggotaan
//  (b) daftarkan otomatis dari kegiatan tempat PML sudah punya data
try {
  db.exec(`INSERT OR IGNORE INTO pml_kegiatan (pml_id, id_kegiatan)
           SELECT id, id_kegiatan FROM users WHERE id_kegiatan IS NOT NULL`);
  db.exec(`INSERT OR IGNORE INTO pml_kegiatan (pml_id, id_kegiatan)
           SELECT DISTINCT pml_id, id_kegiatan FROM responden WHERE pml_id IS NOT NULL`);
} catch (e) { /* tabel responden mungkin belum ada saat pertama kali; abaikan */ }

// ISU 1 + ISU 3: setiap responden terikat ke kegiatan & ke PML pemilik data
if (!_punyaKolom('id_kegiatan')) db.exec(`ALTER TABLE responden ADD COLUMN id_kegiatan INTEGER DEFAULT 1`);
if (!_punyaKolom('pml_id'))      db.exec(`ALTER TABLE responden ADD COLUMN pml_id INTEGER`);

// Tabel pengguna (untuk modul Autentikasi: PML/Supervisor).
// password = hash bcrypt; boleh NULL untuk akun yang login via Google saja.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nama          TEXT,
    email         TEXT UNIQUE NOT NULL,
    password      TEXT,
    google_id     TEXT,
    role          TEXT NOT NULL DEFAULT 'PML',
    reset_token   TEXT,
    reset_expires TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);

// MITIGASI ISU 1: catatan persetujuan Pakta Integritas Kerahasiaan Data per pengguna
const _kolomUsers = db.prepare(`PRAGMA table_info(users)`).all();
const _punyaKolomUser = (n) => _kolomUsers.some((k) => k.name === n);
if (!_punyaKolomUser('pakta_at'))    db.exec(`ALTER TABLE users ADD COLUMN pakta_at TEXT`);
if (!_punyaKolomUser('pakta_versi')) db.exec(`ALTER TABLE users ADD COLUMN pakta_versi TEXT`);
// ISU 2: simpan kedaluwarsa token sebagai epoch ms (INTEGER) -> komparasi bebas timezone
if (!_punyaKolomUser('reset_expires_ms')) db.exec(`ALTER TABLE users ADD COLUMN reset_expires_ms INTEGER`);
// ISU 4 (RBAC): kaitkan PML ke kegiatan yang ditugaskan
if (!_punyaKolomUser('id_kegiatan')) db.exec(`ALTER TABLE users ADD COLUMN id_kegiatan INTEGER`);

// MITIGASI ISU 1: AUDIT TRAIL — mencatat setiap akses/aksi terhadap data rahasia.
// Inilah bukti akuntabilitas: siapa, kapan, melakukan apa, atas berapa baris data.
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email  TEXT,
    aksi        TEXT NOT NULL,
    detail      TEXT,
    jumlah      INTEGER DEFAULT 0,
    ip          TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_audit_waktu ON audit_log(created_at);
`);

// -----------------------------------------------------------------------------
// UTIL: Normalisasi nomor HP Indonesia -> format WhatsApp (62xxxxxxxxxx)
// Contoh: 081338xxxxxx -> 6281338xxxxxx ; +6281.. -> 6281.. ; 81.. -> 6281..
// -----------------------------------------------------------------------------
function normalizeNumber(raw) {
  let n = String(raw || '').replace(/\D/g, ''); // buang semua non-digit
  if (!n) return '';
  if (n.startsWith('0')) n = '62' + n.slice(1);
  else if (n.startsWith('62')) { /* sudah benar */ }
  else if (n.startsWith('8')) n = '62' + n;
  return n;
}

// -----------------------------------------------------------------------------
// PREPARED STATEMENTS (placeholder posisi: ? )
// -----------------------------------------------------------------------------
const stmtInsert = db.prepare(
  // ISU 1+3: sertakan id_kegiatan (survei) & pml_id (pemilik data)
  `INSERT INTO responden (nama_usaha, no_hp, wa_id, nama_petugas, no_hp_petugas, sumber_data, id_kegiatan, pml_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

// Daftar sumber data yang sah (MITIGASI ISU 2)
const SUMBER_VALID = ['SQL_LAB', 'CAPI', 'MANUAL_PML', 'LAINNYA'];
const stmtPending    = db.prepare(`SELECT * FROM responden WHERE status = 'PENDING' ORDER BY id ASC`);
const stmtMarkSent   = db.prepare(`UPDATE responden SET status='TERKIRIM', waktu_kirim=datetime('now','localtime') WHERE id = ?`);
const stmtMarkFailed = db.prepare(`UPDATE responden SET status='GAGAL' WHERE id = ?`);
const stmtFindAwaiting = db.prepare(`SELECT * FROM responden WHERE wa_id = ? AND status = 'TERKIRIM' ORDER BY waktu_kirim DESC LIMIT 1`);
const stmtMarkReply  = db.prepare(`UPDATE responden SET status=?, balasan=?, waktu_balas=datetime('now','localtime') WHERE id = ?`);
const stmtAll        = db.prepare(`SELECT * FROM responden ORDER BY id DESC`);
const stmtResetAll   = db.prepare(`UPDATE responden SET status='PENDING', balasan=NULL, waktu_kirim=NULL, waktu_balas=NULL`);
const stmtResetOne   = db.prepare(`UPDATE responden SET status='PENDING', balasan=NULL, waktu_kirim=NULL, waktu_balas=NULL WHERE id = ?`);
const stmtStats      = db.prepare(`
  SELECT
    COUNT(*)                                                            AS total,
    IFNULL(SUM(status IN ('TERKIRIM','VALID','FRAUD','VALID_MANUAL')),0) AS terkirim,
    IFNULL(SUM(status IN ('VALID','VALID_MANUAL')),0)                   AS valid,
    IFNULL(SUM(status = 'FRAUD'),0)                                     AS fraud,
    IFNULL(SUM(status = 'PENDING'),0)                                   AS pending,
    IFNULL(SUM(status = 'GAGAL'),0)                                     AS gagal
  FROM responden
`);

// Resolusi manual: ubah FRAUD -> VALID_MANUAL (fitur "Validasi Manual")
const stmtResolve    = db.prepare(`
  UPDATE responden
  SET status='VALID_MANUAL', waktu_balas=COALESCE(waktu_balas, datetime('now','localtime'))
  WHERE id = ?
`);

// -----------------------------------------------------------------------------
// FUNGSI PUBLIK
// -----------------------------------------------------------------------------

/** Tambah satu responden. Melempar error bila nomor tidak valid.
 *  no_hp_petugas OPSIONAL — dipakai fitur Auto-Teguran (kirim WA ke PPL). */
function insertResponden({ nama_usaha, no_hp, nama_petugas, no_hp_petugas, sumber_data, id_kegiatan, pml_id }) {
  const wa_id = normalizeNumber(no_hp);
  if (!wa_id) throw new Error(`Nomor HP tidak valid: "${no_hp}"`);
  const info = stmtInsert.run(
    String(nama_usaha).trim(),
    String(no_hp).trim(),
    wa_id,
    String(nama_petugas).trim(),
    no_hp_petugas ? String(no_hp_petugas).trim() : null,
    SUMBER_VALID.includes(sumber_data) ? sumber_data : 'MANUAL_PML',
    Number(id_kegiatan) || 1,               // ISU 1: default kegiatan pertama
    pml_id ? Number(pml_id) : null          // ISU 3: pemilik data (null = milik admin/umum)
  );
  return Number(info.lastInsertRowid);
}

const getPending        = () => stmtPending.all();
const markSent          = (id) => stmtMarkSent.run(id);
const markFailed        = (id) => stmtMarkFailed.run(id);
const findAwaitingByWa  = (wa_id) => stmtFindAwaiting.get(wa_id);
const markReply         = (id, status, balasan) => stmtMarkReply.run(status, balasan, id);
const getAll            = () => stmtAll.all();

// =============================================================================
// ISU 3 — DATA ISOLATION: query yang selalu difilter kegiatan, dan opsional PML.
// scope = { id_kegiatan, pml_id }. Jika pml_id null -> lihat semua (Admin).
// =============================================================================
// Bangun klausa WHERE + objek parameter yang HANYA memuat kunci yang dipakai.
// (node:sqlite menolak named-param yang tidak muncul di SQL.)
function _scopeSQL(scope, extra = {}, alias = '') {
  const a = alias ? alias + '.' : '';           // dukung alias tabel (mis. 'r.') untuk query ber-JOIN
  const p = { id_kegiatan: Number(scope.id_kegiatan) || 1, ...extra };
  let where = `${a}id_kegiatan = @id_kegiatan`;
  if (scope && scope.pml_id != null) {          // PML: kunci ke pemilik data; Admin: dilewati
    where += ` AND ${a}pml_id = @pml_id`;
    p.pml_id = Number(scope.pml_id);
  }
  return { where, p };
}
function getAllScoped(scope) {
  const { where, p } = _scopeSQL(scope);
  return db.prepare(`SELECT * FROM responden WHERE ${where} ORDER BY id DESC`).all(p);
}
function getStatsScoped(scope) {
  const { where, p } = _scopeSQL(scope);
  return db.prepare(`
    SELECT
      COUNT(*)                                                            AS total,
      IFNULL(SUM(status IN ('TERKIRIM','VALID','FRAUD','VALID_MANUAL')),0) AS terkirim,
      IFNULL(SUM(status IN ('VALID','VALID_MANUAL')),0)                   AS valid,
      IFNULL(SUM(status = 'FRAUD'),0)                                     AS fraud,
      IFNULL(SUM(status = 'PENDING'),0)                                   AS pending,
      IFNULL(SUM(status = 'GAGAL'),0)                                     AS gagal
    FROM responden WHERE ${where}`).get(p);
}
// Ambil satu baris dengan penjaga kepemilikan (ISU 3) -> null bila bukan miliknya
function getByIdScoped(id, scope) {
  const { where, p } = _scopeSQL(scope, { id: Number(id) });
  return db.prepare(`SELECT * FROM responden WHERE id = @id AND ${where}`).get(p) || null;
}
function getPendingScoped(scope) {
  const { where, p } = _scopeSQL(scope, {}, 'r'); // alias 'r.' agar cocok dengan JOIN
  // ISU 1: sertakan nama_survei (untuk template pesan WA dinamis)
  return db.prepare(`
    SELECT r.*, k.nama AS nama_survei
    FROM responden r LEFT JOIN kegiatan k ON k.id = r.id_kegiatan
    WHERE r.status='PENDING' AND ${where} ORDER BY r.id ASC`).all(p);
}
// Ambil baris terpilih DALAM scope + nama_survei (untuk Blast Terpilih ter-isolasi)
function getByIdsScoped(ids, scope) {
  if (!ids || !ids.length) return [];
  const list = ids.map((n) => Number(n)).filter(Number.isFinite);
  if (!list.length) return [];
  const ph = list.map(() => '?').join(',');
  const params = [...list, Number(scope.id_kegiatan) || 1]; // posisional: id..., id_kegiatan
  let sql = `SELECT r.*, k.nama AS nama_survei FROM responden r LEFT JOIN kegiatan k ON k.id = r.id_kegiatan WHERE r.id IN (${ph}) AND r.id_kegiatan = ?`;
  if (scope && scope.pml_id != null) { sql += ' AND r.pml_id = ?'; params.push(Number(scope.pml_id)); } // ISU 3
  return db.prepare(sql).all(...params);
}

// ISU 1 — master kegiatan
const listKegiatan   = () => db.prepare(`SELECT * FROM kegiatan ORDER BY aktif DESC, id DESC`).all();

// Daftar id kegiatan yang diikuti seorang PML
const getKegiatanIdsForPml = (pmlId) =>
  db.prepare(`SELECT id_kegiatan FROM pml_kegiatan WHERE pml_id = ?`).all(Number(pmlId)).map((r) => r.id_kegiatan);

// Apakah PML terdaftar pada kegiatan tertentu?
const pmlPunyaKegiatan = (pmlId, idKeg) =>
  !!db.prepare(`SELECT 1 FROM pml_kegiatan WHERE pml_id = ? AND id_kegiatan = ?`).get(Number(pmlId), Number(idKeg));

// Kegiatan yang boleh dilihat user: Admin -> semua; PML -> hanya yang ia ikuti.
function listKegiatanForUser(user) {
  if (user && user.role === 'Admin') return listKegiatan();
  return db.prepare(`
    SELECT k.* FROM kegiatan k
    JOIN pml_kegiatan pk ON pk.id_kegiatan = k.id
    WHERE pk.pml_id = ?
    ORDER BY k.aktif DESC, k.id DESC`).all(Number(user && user.id));
}

// Daftarkan / keluarkan PML dari kegiatan (dipakai Admin)
const daftarkanPml = (pmlId, idKeg) =>
  db.prepare(`INSERT OR IGNORE INTO pml_kegiatan (pml_id, id_kegiatan) VALUES (?, ?)`).run(Number(pmlId), Number(idKeg));
const keluarkanPml = (pmlId, idKeg) =>
  db.prepare(`DELETE FROM pml_kegiatan WHERE pml_id = ? AND id_kegiatan = ?`).run(Number(pmlId), Number(idKeg));

// Daftar seluruh PML beserta kegiatan yang diikutinya (untuk panel kelola PML)
function listPmlDenganKegiatan() {
  const pmls = db.prepare(`SELECT id, nama, email FROM users WHERE role = 'PML' ORDER BY nama`).all();
  return pmls.map((p) => ({ ...p, kegiatan: getKegiatanIdsForPml(p.id) }));
}
const getKegiatan    = (id) => db.prepare(`SELECT * FROM kegiatan WHERE id = ?`).get(Number(id));
const getKegiatanAktif = () => db.prepare(`SELECT * FROM kegiatan WHERE aktif = 1 ORDER BY id DESC LIMIT 1`).get();
function createKegiatan({ kode, nama }) {
  const info = db.prepare(`INSERT INTO kegiatan (kode, nama) VALUES (?, ?)`).run(String(kode).trim().toUpperCase(), String(nama).trim());
  return Number(info.lastInsertRowid);
}
const resetAll          = () => stmtResetAll.run();
const resetOne          = (id) => stmtResetOne.run(id);
const resolveManual     = (id) => stmtResolve.run(id);
const getStats          = () => stmtStats.get();

/** Ambil beberapa responden sekaligus berdasarkan array id (untuk Blast Terpilih). */
function getByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const clean = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (clean.length === 0) return [];
  const placeholders = clean.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM responden WHERE id IN (${placeholders}) ORDER BY id ASC`).all(...clean);
}

// -----------------------------------------------------------------------------
// FILTER STATUS (untuk Tab "Jalur Hijau" & "Indikasi Fraud" — dipakai bila perlu API)
// -----------------------------------------------------------------------------
function getByStatus(list) {
  if (!Array.isArray(list) || list.length === 0) return [];
  const ph = list.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM responden WHERE status IN (${ph}) ORDER BY id DESC`).all(...list);
}

// -----------------------------------------------------------------------------
// STATISTIK HARIAN (untuk Daily Push Notification jam 17:00 ke PML)
// Dihitung dari tanggal waktu_balas = hari ini (waktu lokal).
// -----------------------------------------------------------------------------
const stmtToday = db.prepare(`
  SELECT
    IFNULL(SUM(status IN ('VALID','VALID_MANUAL') AND date(waktu_balas)=date('now','localtime')),0) AS valid,
    IFNULL(SUM(status='FRAUD' AND date(waktu_balas)=date('now','localtime')),0)                     AS fraud
  FROM responden
`);
const stmtTodayFraud = db.prepare(`
  SELECT id, nama_usaha FROM responden
  WHERE status='FRAUD' AND date(waktu_balas)=date('now','localtime') ORDER BY id
`);
function getStatsToday() {
  const s = stmtToday.get();
  return { valid: s.valid, fraud: s.fraud, fraudList: stmtTodayFraud.all() };
}

// -----------------------------------------------------------------------------
// USERS (modul Autentikasi)
// -----------------------------------------------------------------------------
const stmtUserByEmail  = db.prepare(`SELECT * FROM users WHERE email = ?`);
const stmtUserById     = db.prepare(`SELECT * FROM users WHERE id = ?`);
const stmtUserByGoogle = db.prepare(`SELECT * FROM users WHERE google_id = ?`);
const stmtCreateUser   = db.prepare(`INSERT INTO users (nama, email, password, google_id, role) VALUES (?, ?, ?, ?, ?)`);
const stmtLinkGoogle   = db.prepare(`UPDATE users SET google_id = ? WHERE id = ?`);
const stmtSetReset     = db.prepare(`UPDATE users SET reset_token = ?, reset_expires_ms = ? WHERE email = ?`);
const stmtUserByReset  = db.prepare(`SELECT * FROM users WHERE reset_token = ? AND reset_expires_ms > ?`);  // ISU 2: banding epoch vs Date.now()
const stmtUpdatePass   = db.prepare(`UPDATE users SET password = ?, reset_token = NULL, reset_expires_ms = NULL WHERE id = ?`);

const _email = (e) => String(e || '').toLowerCase().trim();
function createUser({ nama, email, password = null, google_id = null, role = 'PML' }) {
  const info = stmtCreateUser.run(nama || '', _email(email), password, google_id, role);
  return Number(info.lastInsertRowid);
}
const findUserByEmail     = (email) => stmtUserByEmail.get(_email(email));
const findUserById        = (id) => stmtUserById.get(id);
const findUserByGoogleId  = (gid) => stmtUserByGoogle.get(gid);
const linkGoogle          = (id, gid) => stmtLinkGoogle.run(gid, id);
const setResetToken       = (email, token, expiresMs) => stmtSetReset.run(token, expiresMs, _email(email)); // expiresMs = Date.now()+3600000
const findUserByResetToken = (token) => stmtUserByReset.get(token, Date.now());  // ISU 2
const updatePassword      = (id, hash) => stmtUpdatePass.run(hash, id);

// =============================================================================
// MITIGASI ISU 1 — KERAHASIAAN DATA
// =============================================================================

/** Masking nomor HP untuk tampilan layar: 081338395794 -> 0813****794
 *  Prinsip: nomor lengkap TIDAK ditampilkan secara default (minimalisasi paparan). */
function maskNumber(no) {
  const s = String(no || '');
  if (s.length < 7) return s ? '****' : '';
  return s.slice(0, 4) + '****' + s.slice(-3);
}

/** Bentuk baris responden versi AMAN untuk dikirim ke browser (nomor ter-masking). */
function toSafeRow(r) {
  if (!r) return r;
  return {
    ...r,
    no_hp: r.anonim_at ? '[DIMUSNAHKAN]' : maskNumber(r.no_hp),
    no_hp_petugas: r.anonim_at ? '[DIMUSNAHKAN]' : maskNumber(r.no_hp_petugas),
    wa_id: undefined, // jangan pernah kirim nomor mentah ke frontend
    _masked: true,
  };
}

/** AUDIT TRAIL: catat setiap aksi terhadap data rahasia. */
const stmtAudit = db.prepare(
  `INSERT INTO audit_log (user_email, aksi, detail, jumlah, ip) VALUES (?, ?, ?, ?, ?)`
);
function logAudit({ user_email, aksi, detail = '', jumlah = 0, ip = '' }) {
  try {
    stmtAudit.run(user_email || '(anonim)', aksi, detail, Number(jumlah) || 0, ip || '');
  } catch (e) {
    console.error('[AUDIT] Gagal mencatat:', e.message);
  }
}
const stmtAuditList = db.prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ?`);
const getAuditLog = (limit = 100) => stmtAuditList.all(Number(limit) || 100);

/** PAKTA INTEGRITAS: tandai pengguna telah menyetujui pernyataan kerahasiaan. */
const stmtPakta = db.prepare(`UPDATE users SET pakta_at = datetime('now','localtime'), pakta_versi = ? WHERE id = ?`);
const acceptPakta = (userId, versi) => stmtPakta.run(String(versi), userId);

/** RETENSI DATA: musnahkan (anonimkan) nomor HP untuk baris yang sudah selesai
 *  diverifikasi lebih dari N hari. Status & statistik tetap utuh untuk laporan. */
const stmtPurge = db.prepare(`
  UPDATE responden
  SET no_hp = '', wa_id = '', no_hp_petugas = '', anonim_at = datetime('now','localtime')
  WHERE anonim_at IS NULL
    AND status IN ('VALID','VALID_MANUAL','FRAUD','GAGAL')
    AND waktu_balas IS NOT NULL
    AND date(waktu_balas) <= date('now','localtime', ?)
`);
function purgeNomorLama(hari = 30) {
  // Catatan: pakai Number.isFinite, BUKAN `|| 30`, agar nilai 0 (musnahkan hari ini)
  // tidak ikut dianggap kosong dan tergantikan default.
  const n = Number(hari);
  const hariBersih = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30;
  const info = stmtPurge.run(`-${hariBersih} days`);
  return Number(info.changes || 0);
}

// =============================================================================
// MITIGASI ISU 2 — SUMBER DATA BERAGAM & VERIFIKASI BERBASIS SAMPEL
// =============================================================================

/** Rekap jumlah baris per sumber data (untuk dashboard & laporan provenance). */
const stmtRekapSumber = db.prepare(
  `SELECT IFNULL(sumber_data,'MANUAL_PML') AS sumber, COUNT(*) AS jumlah FROM responden GROUP BY sumber ORDER BY jumlah DESC`
);
const getRekapSumber = () => stmtRekapSumber.all();

/** SAMPLING ACAK: pilih N responden berstatus PENDING secara acak.
 *  Dipakai bila kerangka data lengkap tidak tersedia — efek jera tetap bekerja
 *  karena petugas tidak tahu kunjungan mana yang akan diverifikasi. */
const stmtSample = db.prepare(`SELECT id FROM responden WHERE status='PENDING' ORDER BY RANDOM() LIMIT ?`);
const getSampleIds = (n = 10) => stmtSample.all(Number(n) || 10).map((r) => r.id);

module.exports = {
  db,
  getAllScoped, getStatsScoped, getByIdScoped, getPendingScoped,   // ISU 3
  listKegiatan, getKegiatan, getKegiatanAktif, createKegiatan,      // ISU 1
  getKegiatanIdsForPml, pmlPunyaKegiatan, listKegiatanForUser,     // keanggotaan PML
  daftarkanPml, keluarkanPml, listPmlDenganKegiatan,
  getByIdsScoped,
  SUMBER_VALID,
  normalizeNumber,
  maskNumber,
  toSafeRow,
  logAudit,
  getAuditLog,
  acceptPakta,
  purgeNomorLama,
  getRekapSumber,
  getSampleIds,
  insertResponden,
  getPending,
  getByIds,
  getByStatus,
  markSent,
  markFailed,
  findAwaitingByWa,
  markReply,
  getAll,
  resetAll,
  resetOne,
  resolveManual,
  getStats,
  getStatsToday,
  // users / auth
  createUser,
  findUserByEmail,
  findUserById,
  findUserByGoogleId,
  linkGoogle,
  setResetToken,
  findUserByResetToken,
  updatePassword,
};
