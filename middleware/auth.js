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
 *   - PML   : hanya datanya sendiri -> pml_id = user.id.
 * id_kegiatan diambil dari query/body/user, jatuh ke kegiatan aktif bila kosong.
 * Untuk PML, kegiatan dipaksa ke kegiatan yang ditugaskan (user.id_kegiatan) bila ada.
 */
function attachScope(getKegiatanAktif) {
  return (req, res, next) => {
    const u = req.user || {};
    const isAdmin = u.role === 'Admin';
    // id_kegiatan: prioritas PILIHAN user (query/body) -> kegiatan tugas -> kegiatan aktif.
    // PML boleh memilih kegiatannya; data tetap aman karena pml_id dikunci ke dirinya.
    let idKeg = Number(req.query.id_kegiatan || (req.body && req.body.id_kegiatan)) || null;
    if (!idKeg && u.id_kegiatan) idKeg = Number(u.id_kegiatan); // fallback: kegiatan tugas dari Admin
    if (!idKeg) {
      const aktif = getKegiatanAktif && getKegiatanAktif();
      idKeg = (aktif && aktif.id) || 1;
    }
    // Admin -> pml_id null (lihat semua PML). PML -> pml_id dirinya (isolasi tetap berlaku).
    req.scope = { id_kegiatan: idKeg, pml_id: isAdmin ? null : u.id };
    next();
  };
}

module.exports = { ensurePage, ensureApi, requireRole, attachScope };
