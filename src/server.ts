import express from 'express';
import eventRoutes from './routes/eventRoutes';
import playerRoutes from './routes/playerRoutes';
import gameRoutes from './routes/gameRoutes';
import path from 'node:path';

const app = express();
const PORT = process.env.PORT || 0;

app.use(express.json());

// Serve static frontend
app.use(express.static(path.join(process.cwd(), 'public')));

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'GameManager API is running',
    version: '1.0.0',
    endpoints: {
      events: {
        create: 'POST /events',
        list: 'GET /events',
        get: 'GET /events/:eventId',
        status: 'GET /events/:eventId/status'
      },
      players: {
        create: 'POST /players',
        get: 'GET /players/:playerId',
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