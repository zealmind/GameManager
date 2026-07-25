import { Router, Request, Response, NextFunction } from 'express';
import { Database } from '../storage/Database';
import { Event } from '../models/Event';
import { authenticate, AuthenticatedRequest, ShareAccess } from '../middleware/auth';
import { withEventAccess, loadEvent } from '../middleware/eventAccess';

const router = Router();
const db = Database.getInstance();

function prepareEventResponse(event: Event) {
  const ev = event as any;
  return {
    id: event.id,
    name: event.name,
    courts: event.courts,
    totalGamesToPlay: event.totalGamesToPlay,
    startedAt: event.startedAt,
    endedAt: event.endedAt,
    ownerId: ev.ownerId,
    players: Array.from(event.players.values()).map((p: any) => ({ id: p.id, name: p.name, ownerId: p.ownerId })),
    registrations: Array.from(event.registrations.values()),
    games: event.games,
    gameHistory: event.gameHistory,
    sharedAccess: event.sharedAccess
  };
}

// POST /events - Create a new event
router.post('/', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const { name, totalGamesToPlay, numCourts } = req.body;
    if (!name || totalGamesToPlay === undefined || numCourts === undefined) {
      return res.status(400).json({ error: 'Missing required fields: name, totalGamesToPlay, numCourts' });
    }
    const ownerId = req.user!.id;
    const event = await db.createEvent(name, totalGamesToPlay, numCourts, ownerId);
    res.status(201).json(prepareEventResponse(event));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /events - List my events + events I moderate
router.get('/', authenticate, (req: AuthenticatedRequest, res) => {
  try {
    const events = db.getEventsForUser(req.user!.id);
    res.json(events.map(prepareEventResponse));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /events/shared - List events shared with me (I am not the owner)
router.get('/shared', authenticate, (req: AuthenticatedRequest, res) => {
  try {
    const events = db.getModeratedEvents(req.user!.id);
    res.json(events.map(prepareEventResponse));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /events/:eventId - Get event details (owner or share token)
router.get('/:eventId', withEventAccess as any, async (req: any, res: any) => {
  try {
    const event = db.getEvent(req.params.eventId as string);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const user = req.user;
    const shareAccess = req.shareAccess as ShareAccess | undefined;

    if (user && (event as any).ownerId === user.id) {
      return res.json(prepareEventResponse(event));
    }

    if (shareAccess && shareAccess.eventId === event.id) {
      return res.json(prepareEventResponse(event));
    }

    return res.status(403).json({ error: 'Forbidden' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /events/:eventId/share - Revoke all share tokens (owner only)
router.delete('/:eventId/share', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const event = db.getEvent(req.params.eventId as string);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if ((event as any).ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    event.sharedAccess = [];
    await db.persist();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /events/:eventId - Delete an event (owner only)
router.delete('/:eventId', authenticate, async (req: AuthenticatedRequest, res) => {
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

// POST /events/:eventId/start - Start an event (owner or moderator)
router.post('/:eventId/start', withEventAccess as any, async (req: any, res: any) => {
  try {
    const event = db.getEvent(req.params.eventId as string);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const user = req.user;
    const shareAccess = req.shareAccess as ShareAccess | undefined;

    const isOwner = user && (event as any).ownerId === user.id;
    const isModerator = shareAccess && shareAccess.eventId === event.id && shareAccess.permission === 'moderator';

    if (!isOwner && !isModerator) {
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

// POST /events/:eventId/share - Generate a viewer share link
router.post('/:eventId/share', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const event = db.getEvent(req.params.eventId as string);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if ((event as any).ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await db.generateShareToken(event.id, 'viewer', req.user!.id);
    res.json({ token: result.token, permission: 'viewer' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /events/:eventId/invite-moderator - Generate a moderator invite link
router.post('/:eventId/invite-moderator', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const event = db.getEvent(req.params.eventId as string);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if ((event as any).ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await db.generateShareToken(event.id, 'moderator', req.user!.id);
    res.json({ token: result.token, permission: 'moderator' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /events/:eventId/players/:playerId - Unregister a player from an event (pre-start only, owner or moderator)
router.delete('/:eventId/players/:playerId', withEventAccess as any, loadEvent as any, async (req: any, res: any) => {
  try {
    const event = req.event;
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const user = req.user;
    const shareAccess = req.shareAccess as ShareAccess | undefined;

    const isOwner = user && (event as any).ownerId === user.id;
    const isModerator = shareAccess && shareAccess.eventId === event.id && shareAccess.permission === 'moderator';

    if (!isOwner && !isModerator) {
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
