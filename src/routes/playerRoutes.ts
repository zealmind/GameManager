import { Router, Request, Response, NextFunction } from 'express';
import { Database } from '../storage/Database';
import { Event } from '../models/Event';
import { authenticate, AuthenticatedRequest, ShareAccess } from '../middleware/auth';
import { withEventAccess, loadEvent } from '../middleware/eventAccess';

const router = Router();
const db = Database.getInstance();

function isOwnerOrModerator(event: any, req: any): boolean {
  const user = req.user as { id: string } | undefined;
  const shareAccess = req.shareAccess as ShareAccess | undefined;
  if (user && event.ownerId === user.id) return true;
  if (shareAccess && shareAccess.eventId === event.id && shareAccess.permission === 'moderator') return true;
  return false;
}

// POST /players - Create a global player
router.post('/', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { name, duprId } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Missing required field: name' });
    }
    const normalizedDuprId =
      duprId == null || String(duprId).trim() === '' ? undefined : String(duprId).trim();
    const player = await db.createPlayer(name, req.user!.id, normalizedDuprId);
    res.status(201).json(player);
  } catch (err: any) {
    if (err?.message?.includes('already exists') || err?.message?.includes('cannot be empty')) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /players - List my players (owned by the current user)
router.get('/', authenticate, (req: AuthenticatedRequest, res) => {
  try {
    const players = db.getPlayersByOwner(req.user!.id);
    res.json(players);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /players/all - List all players across all users (for use in events)
router.get('/all', authenticate, (req: AuthenticatedRequest, res) => {
  try {
    const players = db.getAllPlayers();
    res.json(players);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /players/:playerId - Retrieve player details
router.get('/:playerId', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const player = db.getPlayer(req.params.playerId as string);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    if (player.ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(player);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /players/:playerId - Update player details (name, DUPR ID)
router.patch('/:playerId', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const player = db.getPlayer(req.params.playerId as string);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    if (player.ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { name, duprId } = req.body;
    if (name === undefined && duprId === undefined) {
      return res.status(400).json({ error: 'Provide at least one of: name, duprId' });
    }

    const updates: { name?: string; duprId?: string | null } = {};
    if (name !== undefined) updates.name = name;
    if (duprId !== undefined) updates.duprId = duprId;

    const updated = await db.updatePlayer(player.id, updates);
    res.json(updated);
  } catch (err: any) {
    if (err?.message?.includes('already exists') || err?.message?.includes('cannot be empty')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /events/:eventId/players - Register a player for an event
router.post('/:eventId/players', withEventAccess as any, loadEvent as any, async (req: any, res: any) => {
  try {
    const event = req.event;
    if (!isOwnerOrModerator(event, req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { player_id, name } = req.body;

    let player;
    if (player_id) {
      player = db.getPlayer(player_id);
      if (!player) {
        return res.status(404).json({ error: 'Player not found' });
      }
    } else if (name) {
      const userId = req.user?.id;
      const existing =
        db.findPlayerByName(name) ||
        (userId ? db.findPlayerByDuprId(name, userId) : db.findPlayerByDuprId(name));
      if (existing) {
        player = existing;
      } else {
        if (!userId) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        player = await db.createPlayer(name, userId);
      }
    } else {
      return res.status(400).json({ error: 'Either player_id or name must be provided' });
    }

    const existingReg = event.getRegistration(player.id);
    if (existingReg) {
      return res.status(409).json({ error: 'Player already registered for this event' });
    }

    event.addPlayer(player);
    await db.persistEvent(event.id);
    res.status(201).json({ player, registration: event.getRegistration(player.id) });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /events/:eventId/players/:playerId - Update player status for the event
router.patch('/:eventId/players/:playerId', withEventAccess as any, loadEvent as any, async (req: any, res: any) => {
  try {
    const event = req.event;
    if (!isOwnerOrModerator(event, req)) {
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
      // Ensure returned players are allotment-eligible (priority > 0)
      const reg = event.getRegistration(req.params.playerId as string);
      if (reg && reg.priority <= 0) {
        event.updateRegistration(req.params.playerId as string, { priority: 5 });
      }
    }

    await db.persistEvent(event.id);
    res.json(event.getRegistration(req.params.playerId as string) || updated);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /players/:playerId - Delete a global player
router.delete('/:playerId', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const player = db.getPlayer(req.params.playerId as string);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    if (player.ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await db.deletePlayer(req.params.playerId as string);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
