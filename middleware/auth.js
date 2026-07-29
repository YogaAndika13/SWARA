/**
 * middleware/auth.js
 * ------------------
 * Penjaga rute. Dua varian:
 *  - ensurePage : untuk halaman HTML -> bila belum login, redirect ke /login.
 *  - ensureApi  : untuk endpoint /api -> bila belum login, balas 401 JSON
 *                 (bukan redirect, agar mudah ditangani oleh fetch di frontend).
 */

function ensurePage(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.redirect('/login');
}

function ensureApi(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ error: 'Tidak terautentikasi. Silakan login kembali.' });
}

module.exports = { ensurePage, ensureApi };
