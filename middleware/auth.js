/**
 * middleware/auth.js
 * ------------------
 * Penjaga rute + RBAC (ISU 4) + penentu scope data (ISU 3).
 *  - ensurePage : halaman HTML -> belum login = redirect /login.
 *  - ensureApi  : endpoint /api -> belum login = 401 JSON.
 *  - requireRole('Admin') : hanya role tertentu yang boleh (403 bila tidak).
 *  - attachScope : hitung { id_kegiatan, pml_id } dari user + kegiatan aktif,
 *                  dipakai semua query agar data terisolasi otomatis.
 */

function ensurePage(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.redirect('/login');
}

function ensureApi(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ error: 'Tidak terautentikasi. Silakan login kembali.' });
}

// ISU 4 — RBAC: batasi endpoint ke peran tertentu. Contoh: requireRole('Admin')
function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.user && req.user.role;
    if (roles.includes(role)) return next();
    return res.status(403).json({ error: 'Akses ditolak. Hak akses tidak mencukupi.' });
  };
}

/**
 * ISU 3 — Tentukan cakupan data untuk request ini:
 *   - Admin : boleh lihat semua PML -> pml_id = null (tak difilter pemilik).
 *   - PML   : hanya datanya sendiri -> pml_id = user.id, DAN hanya kegiatan yang ia ikuti.
 * `db` dipakai untuk membaca keanggotaan (pml_kegiatan) & kegiatan aktif.
 */
function attachScope(db) {
  return (req, res, next) => {
    const u = req.user || {};
    const isAdmin = u.role === 'Admin';
    let idKeg = Number(req.query.id_kegiatan || (req.body && req.body.id_kegiatan)) || null;

    if (isAdmin) {
      if (!idKeg) idKeg = (db.getKegiatanAktif() || {}).id || 1;
      req.scope = { id_kegiatan: idKeg, pml_id: null };
      return next();
    }

    // --- PML: kegiatan dibatasi HANYA yang ia ikuti/didaftarkan ---
    const diikuti = db.getKegiatanIdsForPml(u.id); // array id kegiatan
    if (idKeg && diikuti.includes(idKeg)) {
      // pilihan sah -> pakai apa adanya
    } else if (diikuti.length) {
      idKeg = diikuti[0]; // pilihan di luar keanggotaan -> koreksi ke kegiatan pertama miliknya
    } else {
      idKeg = null; // belum didaftarkan ke kegiatan mana pun
    }
    req.scope = { id_kegiatan: idKeg, pml_id: u.id, kegiatanDiikuti: diikuti };
    next();
  };
}

module.exports = { ensurePage, ensureApi, requireRole, attachScope };
