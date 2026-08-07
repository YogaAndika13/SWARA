/**
 * config/sqlite-session-store.js
 * ------------------------------
 * Penyimpan sesi login di SQLite (bukan di memori), agar:
 *  - sesi tidak hilang saat server restart, dan
 *  - stabil ketika banyak PML mengakses (memori tak menumpuk/bocor).
 * Dibangun di atas node:sqlite bawaan Node -> TANPA pustaka tambahan.
 */
const session = require('express-session');

module.exports = function createSqliteStore(db) {
  const Store = session.Store;

  // Tabel penyimpan sesi (kolom sid unik + data JSON + kedaluwarsa epoch ms)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid     TEXT PRIMARY KEY,
      data    TEXT NOT NULL,
      expires INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires);
  `);

  const stmtGet = db.prepare(`SELECT data, expires FROM sessions WHERE sid = ?`);
  const stmtSet = db.prepare(`INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?)
                              ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires`);
  const stmtDel = db.prepare(`DELETE FROM sessions WHERE sid = ?`);
  const stmtPurge = db.prepare(`DELETE FROM sessions WHERE expires <= ?`);

  const _expOf = (sess) => {
    // Ambil masa berlaku dari cookie; default 8 jam bila tak ada.
    const ttl = (sess.cookie && sess.cookie.maxAge) || 1000 * 60 * 60 * 8;
    return Date.now() + ttl;
  };

  class SqliteStore extends Store {
    get(sid, cb) {
      try {
        const row = stmtGet.get(sid);
        if (!row) return cb(null, null);
        if (row.expires <= Date.now()) { stmtDel.run(sid); return cb(null, null); } // sudah kedaluwarsa
        return cb(null, JSON.parse(row.data));
      } catch (e) { return cb(e); }
    }
    set(sid, sess, cb) {
      try { stmtSet.run(sid, JSON.stringify(sess), _expOf(sess)); cb && cb(null); }
      catch (e) { cb && cb(e); }
    }
    destroy(sid, cb) {
      try { stmtDel.run(sid); cb && cb(null); } catch (e) { cb && cb(e); }
    }
    touch(sid, sess, cb) {
      // Perpanjang masa berlaku saat sesi masih aktif
      try { db.prepare(`UPDATE sessions SET expires = ? WHERE sid = ?`).run(_expOf(sess), sid); cb && cb(null); }
      catch (e) { cb && cb(e); }
    }
  }

  // Bersihkan sesi kedaluwarsa berkala (tiap 1 jam)
  setInterval(() => { try { stmtPurge.run(Date.now()); } catch (_) {} }, 60 * 60 * 1000).unref?.();

  return new SqliteStore();
};
