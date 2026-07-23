import { Router } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Database } from '../storage/Database';
import { hashPassword, verifyPassword, signJwt } from '../middleware/auth';

const router = Router();
const db = Database.getInstance();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const APP_URL = process.env.APP_URL || process.env.BASE_URL || 'http://localhost:4444';

const oauthStateStore = new Map<string, { redirect?: string }>();

function getClientIp(req: { ip?: string; connection?: { remoteAddress?: string } }) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

// POST /auth/register - Local email/password registration
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Missing required fields: email, password, name' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await db.client.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const id = crypto.randomUUID();
    const passwordHash = hashPassword(password);

    await db.client.execute(
      'INSERT INTO users (id, email, name, password_hash, provider) VALUES (?, ?, ?, ?, ?)',
      [id, email, name, passwordHash, 'local']
    );

    const token = signJwt(id);
    res.status(201).json({ token, user: { id, email, name, provider: 'local' } });
  } catch (err) {
    console.error('Register error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/login - Local email/password login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing required fields: email, password' });
    }

    const result = await db.client.execute(
      'SELECT id, email, name, password_hash, provider FROM users WHERE email = ?',
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0] as any;
    if (user.provider !== 'local' || !user.password_hash) {
      return res.status(401).json({ error: 'Please use social login for this account' });
    }

    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signJwt(user.id);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, provider: user.provider } });
  } catch (err) {
    console.error('Login error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /auth/me - Get current user
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : (req as any).cookies?.token;

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    const result = await db.client.execute(
      'SELECT id, email, name, provider, avatar_url FROM users WHERE id = ?',
      [decoded.userId]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    const user = result.rows[0] as any;
    res.json({ user: { id: user.id, email: user.email, name: user.name, provider: user.provider, avatarUrl: user.avatar_url } });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// GET /auth/github - Initiate GitHub OAuth
router.get('/github', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const redirect = (req.query.redirect_to as string | undefined) || '/';
  oauthStateStore.set(state, { redirect });

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID || '',
    redirect_uri: `${APP_URL}/auth/github/callback`,
    scope: 'user:email',
    state
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

// GET /auth/github/callback - GitHub OAuth callback
router.get('/github/callback', async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };
  if (!code || !state || !oauthStateStore.has(state)) {
    return res.status(400).send('Invalid OAuth callback');
  }

  const stored = oauthStateStore.get(state)!;
  oauthStateStore.delete(state);

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code
      })
    });

    const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      return res.status(400).send('Failed to get access token');
    }

    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/json'
      }
    });
    const userData = await userRes.json() as { id: number; name?: string; login: string; avatar_url?: string };

    const emailsRes = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/json'
      }
    });
    const emails = await emailsRes.json() as Array<{ primary?: boolean; email?: string }>;
    const primaryEmail = (emails.find((e: any) => e.primary)?.email || emails[0]?.email || `${userData.id}@github.user`) as string;

    const id = crypto.randomUUID();
    const existing = await db.client.execute('SELECT id FROM users WHERE provider = ? AND provider_id = ?', ['github', String(userData.id)]);

    let userId: string;
    if (existing.rows.length > 0) {
      userId = (existing.rows[0] as any).id;
    } else {
      userId = crypto.randomUUID();
      await db.client.execute(
        'INSERT INTO users (id, email, name, provider, provider_id, avatar_url) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, primaryEmail, userData.name || userData.login || 'GitHub User', 'github', String(userData.id), userData.avatar_url || null]
      );
    }

    const token = signJwt(userId);
    const redirectTo = stored.redirect || '/';
    res.redirect(`${redirectTo}?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('GitHub callback error', err);
    res.status(500).send('OAuth failed');
  }
});

// GET /auth/google - Initiate Google OAuth
router.get('/google', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const redirect = (req.query.redirect_to as string | undefined) || '/';
  oauthStateStore.set(state, { redirect });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    redirect_uri: `${APP_URL}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid profile email',
    state
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// GET /auth/google/callback - Google OAuth callback
router.get('/google/callback', async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };
  if (!code || !state || !oauthStateStore.has(state)) {
    return res.status(400).send('Invalid OAuth callback');
  }

  const stored = oauthStateStore.get(state)!;
  oauthStateStore.delete(state);

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirect_uri: `${APP_URL}/auth/google/callback`,
        grant_type: 'authorization_code'
      }).toString()
    });

    const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      return res.status(400).send('Failed to get access token');
    }

    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const userData = await userRes.json() as { sub: string; email?: string; name?: string; picture?: string };

    const id = crypto.randomUUID();
    const existing = await db.client.execute('SELECT id FROM users WHERE provider = ? AND provider_id = ?', ['google', userData.sub]);

    let userId: string;
    if (existing.rows.length > 0) {
      userId = (existing.rows[0] as any).id;
    } else {
      userId = crypto.randomUUID();
      await db.client.execute(
        'INSERT INTO users (id, email, name, provider, provider_id, avatar_url) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, userData.email || `${userData.sub}@google.user`, userData.name || 'Google User', 'google', userData.sub, userData.picture || null]
      );
    }

    const token = signJwt(userId);
    const redirectTo = stored.redirect || '/';
    res.redirect(`${redirectTo}?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('Google callback error', err);
    res.status(500).send('OAuth failed');
  }
});

export default router;
