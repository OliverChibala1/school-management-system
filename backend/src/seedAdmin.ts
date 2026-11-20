import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';

const name = process.env.ADMIN_NAME?.trim();
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';
if (!name || !email || password.length < 14 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
  console.error('Set ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD in .env. Password must be at least 14 characters and include uppercase and lowercase letters and a number.');
  process.exit(1);
}
try {
  const hash = await bcrypt.hash(password, 12);
  await pool.query(`INSERT INTO app_users(full_name,email,password_hash,role) VALUES($1,$2,$3,'admin') ON CONFLICT(email) DO UPDATE SET full_name=EXCLUDED.full_name,password_hash=EXCLUDED.password_hash,role='admin',is_active=TRUE,updated_at=NOW()`, [name, email, hash]);
  console.log('Admin account synchronized with the configured seed credentials.');
} catch (err) { console.error(err); process.exitCode = 1; }
finally { await pool.end(); }
