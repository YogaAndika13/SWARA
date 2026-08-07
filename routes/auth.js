/**
 * routes/auth.js
 * --------------
 * Semua rute autentikasi (publik, tidak butuh login):
 *  - GET  /login, /signup, /forgot, /reset/:token  -> halaman HTML
 *  - POST /signup           -> registrasi PML/Supervisor (password di-hash bcrypt)
 *  - POST /login            -> Passport Local
 *  - POST /forgot           -> buat token reset (simulasi link)
 *  - POST /reset/:token     -> set password baru
 *  - GET  /auth/google, /auth/google/callback -> Google OAuth
 *  - POST /logout           -> keluar
 */

const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const express = require('express');

const db = require('../database');
const passport = require('../config/passport');
const rateLimit = require('../middleware/rate-limit'); // PENGAMAN 3

const router = express.Router();
const view = (file) => path.join(__dirname, '..', 'views', file);

// PENGAMAN 3: batasi percobaan pada endpoint autentikasi (anti brute-force).
// Login lebih ketat; reset/forgot/signup sedikit lebih longgar.
const limitLogin = rateLimit({ windowMs: 60_000, max: 8, pesan: 'Terlalu banyak percobaan login. Coba lagi sebentar lagi.' });
const limitAuth = rateLimit({ windowMs: 60_000, max: 12 });

// Ubah error teknis menjadi pesan yang jelas & memberi solusi ke pengguna.
function pesanError(err) {
  const m = (err && err.message) || 'Kesalahan tidak diketahui.';
  if (/is not a function/.test(m)) {
    return 'Server belum lengkap: file database.js versi lama masih terpasang. ' +
      'Timpa database.js dengan versi terbaru lalu jalankan ulang server (npm start).';
  }
  if (/UNIQUE constraint failed|already exists/i.test(m)) {
    return 'Email sudah terdaftar. Silakan login atau gunakan email lain.';
  }
  return 'Terjadi kesalahan di server. Detail dicatat di konsol server.';
}

// --- HALAMAN -----------------------------------------------------------------
router.get('/login', (req, res) => res.sendFile(view('login.html')));
router.get('/signup', (req, res) => res.sendFile(view('signup.html')));
router.get('/forgot', (req, res) => res.sendFile(view('forgot.html')));
router.get('/reset/:token', (req, res) => res.sendFile(view('reset.html')));

// --- REGISTRASI --------------------------------------------------------------
router.post('/signup', limitAuth, (req, res) => {
  // PENGAMAN 2: swa-daftar dinonaktifkan secara default saat aplikasi diakses publik.
  // Akun PML dibuat oleh Admin. Aktifkan kembali dengan ALLOW_SIGNUP=1 di .env bila perlu.
  if (process.env.ALLOW_SIGNUP !== '1') {
    return res.status(403).json({ error: 'Pendaftaran mandiri dinonaktifkan. Hubungi Admin untuk pembuatan akun.' });
  }
  try {
    const { nama, email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email dan password wajib diisi.' });
    if (String(password).length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter.' });
    if (db.findUserByEmail(email)) return res.status(409).json({ error: 'Email sudah terdaftar.' });

    // Hash password dengan bcrypt (10 salt rounds)
    const hash = bcrypt.hashSync(String(password), 10);
    db.createUser({ nama, email, password: hash, role: 'PML' });
    return res.status(201).json({ ok: true, message: 'Registrasi berhasil. Silakan login.' });
  } catch (err) {
    console.error('[SIGNUP] Error teknis:', err.message);
    return res.status(500).json({ error: pesanError(err) });
  }
});

// --- LOGIN (Passport Local) --------------------------------------------------
router.post('/login', limitLogin, (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      console.error('[LOGIN] Error teknis:', err.message);
      return res.status(500).json({ error: pesanError(err) });
    }
    if (!user) return res.status(401).json({ error: (info && info.message) || 'Login gagal.' });
    req.logIn(user, (e) => {
      if (e) return res.status(500).json({ error: e.message });
      // AUDIT TRAIL (MITIGASI ISU 1): catat setiap keberhasilan masuk ke sistem
      db.logAudit({
        user_email: user.email,
        aksi: 'LOGIN',
        detail: 'login email & password',
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      });
      return res.json({ ok: true, redirect: '/' });
    });
  })(req, res, next);
});

// --- FORGOT PASSWORD (simulasi link reset) -----------------------------------
router.post('/forgot', limitAuth, (req, res) => {
  const { email } = req.body;
  const user = email && db.findUserByEmail(email);

  // Selalu balas sukses (jangan bocorkan email mana yang terdaftar - keamanan).
  if (user) {
    const token = crypto.randomBytes(24).toString('hex');
    // ISU 2: simpan sebagai epoch ms (angka), bukan string ISO/UTC -> komparasi bebas timezone
    const expiresMs = Date.now() + 60 * 60 * 1000; // berlaku 1 jam
    db.setResetToken(email, token, expiresMs);
    const link = `${req.protocol}://${req.get('host')}/reset/${token}`;
    // SIMULASI: di produksi link ini dikirim via email. Di sini kita tampilkan di log.
    console.log(`\n[RESET PASSWORD] Link reset untuk ${email} (berlaku 1 jam):\n${link}\n`);
  }
  return res.json({ ok: true, message: 'Jika email terdaftar, link reset telah dibuat (lihat konsol server).' });
});

// --- RESET PASSWORD ----------------------------------------------------------
router.post('/reset/:token', limitAuth, (req, res) => {
  const { password } = req.body;
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter.' });
  const user = db.findUserByResetToken(req.params.token);
  if (!user) return res.status(400).json({ error: 'Token tidak valid atau sudah kedaluwarsa.' });
  db.updatePassword(user.id, bcrypt.hashSync(String(password), 10));
  return res.json({ ok: true, message: 'Password berhasil diubah. Silakan login.' });
});

// --- GOOGLE OAUTH ------------------------------------------------------------
router.get('/auth/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).send('Login Google belum dikonfigurasi di server (.env).');
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});
router.get(
  '/auth/google/callback',
  (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID) return res.redirect('/login');
    passport.authenticate('google', { failureRedirect: '/login' })(req, res, next);
  },
  (req, res) => res.redirect('/')
);

// --- LOGOUT ------------------------------------------------------------------
router.post('/logout', (req, res) => {
  req.logout(() => res.json({ ok: true, redirect: '/login' }));
});

module.exports = router;
