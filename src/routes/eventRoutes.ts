import { Router } from 'express';
import { Database } from '../storage/Database';
import { Event } from '../models/Event';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

const router = Router();
const db = Database.getInstance();

router.use(authenticate);

// POST /events - Create a new event
router.post('/', async (req: AuthenticatedRequest, res) => {
  try {
    const { name, totalGamesToPlay, numCourts } = req.body;
    if (!name || totalGamesToPlay === undefined || numCourts === undefined) {
      return res.status(400).json({ error: 'Missing required fields: name, totalGamesToPlay, numCourts' });
    }
    const ownerId = req.user!.id;
    const event = await db.createEvent(name, totalGamesToPlay, numCourts, ownerId);
    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /events - List my events
router.get('/', (req: AuthenticatedRequest, res) => {
  try {
    const events = db.getEventsByOwner(req.user!.id);
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /events/:eventId - Get event details
router.get('/:eventId', async (req: AuthenticatedRequest, res) => {
  try {
    const event = db.getEvent(req.params.eventId as string);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if ((event as any).ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /events/:eventId - Delete an event
router.delete('/:eventId', async (req: AuthenticatedRequest, res) => {
  try {
    const event = db.getEvent(req.params.eventId as string);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if ((event as any).ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await db.deleteEvent(req.params.eventId as string);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /events/:eventId/start - Start an event
router.post('/:eventId/start', async (req: AuthenticatedRequest, res) => {
  try {
    const event = db.getEvent(req.params.eventId as string);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if ((event as any).ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (event.isStarted()) {
      return res.status(400).json({ error: 'Event has already started' });
    }
    event.start();
    await db.persist();
    res.json({ success: true, startedAt: event.startedAt });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /events/:eventId/players/:playerId - Unregister a player from an event (pre-start only)
router.delete('/:eventId/players/:playerId', async (req: AuthenticatedRequest, res) => {
  try {
    const event = db.getEvent(req.params.eventId as string);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if ((event as any).ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (event.isStarted()) {
      return res.status(400).json({ error: 'Cannot unregister after event has started' });
    }
    event.removePlayer(req.params.playerId as string);
    await db.persist();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
