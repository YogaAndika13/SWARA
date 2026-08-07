/**
 * middleware/rate-limit.js
 * ------------------------
 * PENGAMAN 3: pembatas laju permintaan (anti brute-force) TANPA pustaka tambahan.
 * Menghitung jumlah permintaan per IP dalam jendela waktu; bila melebihi batas,
 * balas 429 (Too Many Requests). Cocok untuk melindungi /login saat URL publik.
 */

function rateLimit({ windowMs = 60_000, max = 10, pesan } = {}) {
  const hits = new Map(); // ip -> { count, reset }

  // Bersihkan entri kedaluwarsa berkala agar Map tidak menumpuk
  setInterval(() => {
    const now = Date.now();
    for (const [ip, v] of hits) if (v.reset <= now) hits.delete(ip);
  }, windowMs).unref?.();

  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let v = hits.get(ip);
    if (!v || v.reset <= now) { v = { count: 0, reset: now + windowMs }; hits.set(ip, v); }
    v.count++;

    const sisa = Math.max(0, max - v.count);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', sisa);

    if (v.count > max) {
      const detik = Math.ceil((v.reset - now) / 1000);
      res.setHeader('Retry-After', detik);
      return res.status(429).json({
        error: pesan || `Terlalu banyak percobaan. Coba lagi dalam ${detik} detik.`,
      });
    }
    next();
  };
}

module.exports = rateLimit;
