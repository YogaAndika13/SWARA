/**
 * config/passport.js
 * ------------------
 * Konfigurasi Passport.js:
 *  - LocalStrategy  : login email + password (dicek dengan bcrypt).
 *  - GoogleStrategy : login via Google OAuth 2.0 (HANYA diaktifkan bila
 *                     GOOGLE_CLIENT_ID & SECRET tersedia di .env).
 *
 * Session: kita hanya menyimpan user.id (serialize), lalu memuat ulang
 * data user dari DB saat request berikutnya (deserialize).
 */

const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const db = require('../database');

// --- STRATEGI LOCAL (email + password) ---------------------------------------
passport.use(
  new LocalStrategy({ usernameField: 'email', passwordField: 'password' }, (email, password, done) => {
    try {
      const user = db.findUserByEmail(email);
      if (!user) return done(null, false, { message: 'Email tidak terdaftar.' });
      if (!user.password) {
        // Akun ini dibuat via Google, jadi tidak punya password lokal
        return done(null, false, { message: 'Akun ini terdaftar via Google. Silakan login dengan Google.' });
      }
      const cocok = bcrypt.compareSync(password, user.password);
      if (!cocok) return done(null, false, { message: 'Password salah.' });
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

// --- STRATEGI GOOGLE (opsional, aktif bila kredensial diisi) -----------------
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  const GoogleStrategy = require('passport-google-oauth20').Strategy;
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
      },
      (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails && profile.emails[0] && profile.emails[0].value;
          const nama = profile.displayName || 'Pengguna Google';

          // 1) Sudah pernah login Google -> pakai akun itu
          let user = db.findUserByGoogleId(profile.id);
          if (user) return done(null, user);

          // 2) Email sudah terdaftar (via password) -> tautkan google_id
          if (email) {
            const existing = db.findUserByEmail(email);
            if (existing) {
              db.linkGoogle(existing.id, profile.id);
              return done(null, db.findUserById(existing.id));
            }
          }

          // 3) Buat akun baru (tanpa password lokal)
          const id = db.createUser({ nama, email, google_id: profile.id, role: 'PML' });
          return done(null, db.findUserById(id));
        } catch (err) {
          return done(err);
        }
      }
    )
  );
  console.log('[AUTH] Google OAuth aktif.');
} else {
  console.warn('[AUTH] Google OAuth non-aktif (GOOGLE_CLIENT_ID/SECRET belum diisi di .env).');
}

// --- SERIALIZE / DESERIALIZE -------------------------------------------------
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  try {
    done(null, db.findUserById(id) || false);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;
