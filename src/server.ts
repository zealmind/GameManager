import express from 'express';
import cors from 'cors';
import eventRoutes from './routes/eventRoutes';
import playerRoutes from './routes/playerRoutes';
import gameRoutes from './routes/gameRoutes';
import authRoutes from './routes/authRoutes';
import path from 'node:path';

import { Database } from './storage/Database';

const app = express();
const PORT = process.env.PORT || 0;

app.use(express.json());
app.use(cors());

// Public token resolution
app.get('/share/:token', (req, res) => {
  try {
    const token = req.params.token as string;
    const db = Database.getInstance();
    const access = db.resolveShareToken(token);
    if (!access) {
      return res.status(404).json({ error: 'Invalid or expired share link' });
    }
    res.json({ eventId: access.eventId, permission: access.permission });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve static frontend
app.use(express.static(path.join(process.cwd(), 'public')));

// Public auth routes
app.use('/auth', authRoutes);

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'GameManager API is running',
    version: '1.0.0',
    endpoints: {
      auth: {
        register: 'POST /auth/register',
        login: 'POST /auth/login',
        me: 'GET /auth/me',
        github: 'GET /auth/github',
        google: 'GET /auth/google'
      },
      events: {
        create: 'POST /events',
        list: 'GET /events',
        get: 'GET /events/:eventId',
        rename: 'PATCH /events/:eventId',
        copy: 'POST /events/:eventId/copy',
        status: 'GET /events/:eventId/status'
      },
      players: {
        create: 'POST /players',
        get: 'GET /players/:playerId',
        update: 'PATCH /players/:playerId',
        register: 'POST /events/:eventId/players',
        updateStatus: 'PATCH /events/:eventId/players/:playerId'
      },
      games: {
        schedule: 'POST /events/:eventId/schedule',
        score: 'POST /events/:eventId/games/:gameId/score',
        list: 'GET /events/:eventId/games'
      }
    }
  });
});

app.use('/events', eventRoutes);
app.use('/players', playerRoutes);
app.use('/events', playerRoutes);
app.use('/events', gameRoutes);

// Serve app shell for SPA routes
app.get('*', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

export default app;
