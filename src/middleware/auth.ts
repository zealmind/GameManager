import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { Database } from '../storage/Database';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '7d';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const computed = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
}

export function signJwt(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET as jwt.Secret, { expiresIn: JWT_EXPIRY } as any);
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (req as any).cookies?.token;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const db = Database.getInstance();
    const result = await db.client.execute(
      'SELECT id, email, name, provider, avatar_url FROM users WHERE id = ?',
      [decoded.userId]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    const user = result.rows[0] as any;
    (req as AuthenticatedRequest).user = {
      id: user.id,
      email: user.email,
      name: user.name,
      provider: user.provider,
      avatarUrl: user.avatar_url
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    provider: string;
    avatarUrl?: string;
  };
}
