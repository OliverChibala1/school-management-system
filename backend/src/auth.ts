import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';

export type Role = 'admin' | 'headteacher' | 'registrar' | 'teacher' | 'parent' | 'student';
export interface AuthRequest extends Request { user?: { id: string; email: string; role: Role; fullName: string } }

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required.' });
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) return res.status(500).json({ error: 'Server authentication is not configured securely.' });
    const payload = jwt.verify(header.slice(7), secret) as jwt.JwtPayload;
    const result = await pool.query('SELECT id, email, role, full_name FROM app_users WHERE id=$1 AND is_active=TRUE', [payload.sub]);
    if (!result.rowCount) return res.status(401).json({ error: 'Account is unavailable.' });
    req.user = { id: result.rows[0].id, email: result.rows[0].email, role: result.rows[0].role, fullName: result.rows[0].full_name };
    next();
  } catch { return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' }); }
}

export function allowRoles(...roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    next();
  };
}
