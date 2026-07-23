import { Router } from 'express';
import { Database } from '../storage/Database';
import { Event } from '../models/Event';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

const router = Router();
const db = Database.getInstance();

router.use(authenticate);

// POST /players - Create a global player
router.post('/', async (req: AuthenticatedRequest, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Missing required field: name' });
    }
    const player = await db.createPlayer(name, req.user!.id);
    res.status(201).json(player);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /players - List my players
router.get('/', (req: AuthenticatedRequest, res) => {
  try {
    const players = db.getPlayersByOwner(req.user!.id);
    res.json(players);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /players/:playerId - Retrieve player details
router.get('/:playerId', async (req: AuthenticatedRequest, res) => {
  try {
    const player = db.getPlayer(req.params.playerId as string);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    if ((player as any).ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(player);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /events/:eventId/players - Register a player for an event
router.post('/:eventId/players', async (req: AuthenticatedRequest, res) => {
  try {
    const event = db.getEvent(req.params.eventId as string);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if ((event as any).ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { player_id, name } = req.body;

    let player;
    if (player_id) {
      player = db.getPlayer(player_id);
      if (!player) {
        return res.status(404).json({ error: 'Player not found' });
      }
      if ((player as any).ownerId !== req.user!.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    } else if (name) {
      const existing = db.findPlayerByName(name);
      if (existing) {
        player = existing;
      } else {
        player = await db.createPlayer(name, req.user!.id);
      }
    } else {
      return res.status(400).json({ error: 'Either player_id or name must be provided' });
    }

    const existingReg = event.getRegistration(player.id);
    if (existingReg) {
      return res.status(409).json({ error: 'Player already registered for this event' });
    }

    event.addPlayer(player);
    await db.persist();
    res.status(201).json({ player, registration: event.getRegistration(player.id) });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /events/:eventId/players/:playerId - Update player status for the event
router.patch('/:eventId/players/:playerId', async (req: AuthenticatedRequest, res) => {
  try {
    const event = db.getEvent(req.params.eventId as string);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if ((event as any).ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Missing required field: status' });
    }
    const validStatuses = ['WAITING', 'PLAYING', 'UNAVAILABLE', 'AWAY', 'RETIRED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be WAITING, PLAYING, UNAVAILABLE, AWAY, or RETIRED' });
    }

    const updated = event.updateRegistration(req.params.playerId as string, { status });
    if (!updated) {
      return res.status(404).json({ error: 'Player registration not found for this event' });
    }

    if (status === 'WAITING') {
      event.recalculateTargetGames();
    }

    await db.persist();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /players/:playerId - Delete a global player
router.delete('/:playerId', async (req: AuthenticatedRequest, res) => {
  try {
    const player = db.getPlayer(req.params.playerId as string);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    if ((player as any).ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await db.deletePlayer(req.params.playerId as string);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
