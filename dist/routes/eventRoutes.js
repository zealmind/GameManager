"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const Database_1 = require("../storage/Database");
const auth_1 = require("../middleware/auth");
const eventAccess_1 = require("../middleware/eventAccess");
const router = (0, express_1.Router)();
const db = Database_1.Database.getInstance();
const VALID_EVENT_FORMATS = ['ROTATING_DOUBLES', 'FIXED_PARTNER_DOUBLES', 'SINGLES_ROUND_ROBIN'];
function prepareEventResponse(event) {
    const ev = event;
    return {
        id: event.id,
        name: event.name,
        format: event.format,
        courts: event.courts,
        totalGamesToPlay: event.totalGamesToPlay,
        startedAt: event.startedAt,
        endedAt: event.endedAt,
        ownerId: ev.ownerId,
        players: Array.from(event.players.values()).map((p) => {
            const reg = event.registrations.get(p.id);
            return {
                id: p.id,
                name: p.name,
                nickName: reg?.nickName,
                duprId: p.duprId,
                ownerId: p.ownerId,
            };
        }),
        registrations: Array.from(event.registrations.values()),
        games: event.games,
        gameHistory: event.gameHistory,
        sharedAccess: event.sharedAccess
    };
}
// POST /events - Create a new event
router.post('/', auth_1.authenticate, async (req, res) => {
    try {
        const { name, totalGamesToPlay, numCourts, format } = req.body;
        if (!name || totalGamesToPlay === undefined || numCourts === undefined) {
            return res.status(400).json({ error: 'Missing required fields: name, totalGamesToPlay, numCourts' });
        }
        const eventFormat = format || 'ROTATING_DOUBLES';
        if (!VALID_EVENT_FORMATS.includes(eventFormat)) {
            return res.status(400).json({ error: 'Invalid format. Must be ROTATING_DOUBLES, FIXED_PARTNER_DOUBLES, or SINGLES_ROUND_ROBIN' });
        }
        const ownerId = req.user.id;
        const event = await db.createEvent(name, totalGamesToPlay, numCourts, ownerId, eventFormat);
        res.status(201).json(prepareEventResponse(event));
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /events - List my events + events I moderate
router.get('/', auth_1.authenticate, (req, res) => {
    try {
        const events = db.getEventsForUser(req.user.id);
        res.json(events.map(prepareEventResponse));
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /events/shared - List events shared with me (I am not the owner)
router.get('/shared', auth_1.authenticate, (req, res) => {
    try {
        const events = db.getModeratedEvents(req.user.id);
        res.json(events.map(prepareEventResponse));
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /events/:eventId - Get event details (owner or share token)
router.get('/:eventId', eventAccess_1.withEventAccess, async (req, res) => {
    try {
        const event = db.getEvent(req.params.eventId);
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        const user = req.user;
        const shareAccess = req.shareAccess;
        if (user && event.ownerId === user.id) {
            return res.json(prepareEventResponse(event));
        }
        if (shareAccess && shareAccess.eventId === event.id) {
            return res.json(prepareEventResponse(event));
        }
        return res.status(403).json({ error: 'Forbidden' });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// DELETE /events/:eventId/share - Revoke all share tokens (owner only)
router.delete('/:eventId/share', auth_1.authenticate, async (req, res) => {
    try {
        const event = db.getEvent(req.params.eventId);
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        if (event.ownerId !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        event.sharedAccess = [];
        await db.persistEvent(event.id);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// PATCH /events/:eventId - Rename an event (owner only)
router.patch('/:eventId', auth_1.authenticate, async (req, res) => {
    try {
        const event = await requireEventOwner(req, res);
        if (!event)
            return;
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        if (!name) {
            return res.status(400).json({ error: 'Missing required field: name' });
        }
        event.name = name;
        await db.persistEvent(event.id);
        res.json(prepareEventResponse(event));
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /events/:eventId/copy - Copy an event with players only, unstarted (owner only)
router.post('/:eventId/copy', auth_1.authenticate, async (req, res) => {
    try {
        const source = await requireEventOwner(req, res);
        if (!source)
            return;
        const requestedName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        const name = requestedName || `Copy of ${source.name}`;
        const event = await db.copyEvent(source.id, name, req.user.id);
        res.status(201).json(prepareEventResponse(event));
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// DELETE /events/:eventId - Delete an event (owner only)
router.delete('/:eventId', auth_1.authenticate, async (req, res) => {
    try {
        const event = db.getEvent(req.params.eventId);
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        if (event.ownerId !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        await db.deleteEvent(req.params.eventId);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /events/:eventId/start - Start an event (owner or moderator)
router.post('/:eventId/start', eventAccess_1.withEventAccess, async (req, res) => {
    try {
        const event = db.getEvent(req.params.eventId);
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        const user = req.user;
        const shareAccess = req.shareAccess;
        const isOwner = user && event.ownerId === user.id;
        const isModerator = shareAccess && shareAccess.eventId === event.id && shareAccess.permission === 'moderator';
        if (!isOwner && !isModerator) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        if (event.isStarted()) {
            return res.status(400).json({ error: 'Event has already started' });
        }
        const validation = event.validateCanStart();
        if (!validation.ok) {
            return res.status(400).json({ error: validation.error });
        }
        event.start();
        await db.persistEvent(event.id);
        res.json({ success: true, startedAt: event.startedAt });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
async function requireEventOwner(req, res) {
    const event = db.getEvent(req.params.eventId);
    if (!event) {
        res.status(404).json({ error: 'Event not found' });
        return null;
    }
    if (event.ownerId !== req.user.id) {
        res.status(403).json({ error: 'Forbidden' });
        return null;
    }
    return event;
}
// POST /events/:eventId/share - Get or create the viewer share link (one token)
router.post('/:eventId/share', auth_1.authenticate, async (req, res) => {
    try {
        const event = await requireEventOwner(req, res);
        if (!event)
            return;
        const result = await db.getOrCreateShareToken(event.id, 'viewer', req.user.id);
        res.json({ token: result.token, permission: 'viewer', created: result.created });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /events/:eventId/share/refresh - Revoke viewer token and issue a new one
router.post('/:eventId/share/refresh', auth_1.authenticate, async (req, res) => {
    try {
        const event = await requireEventOwner(req, res);
        if (!event)
            return;
        const result = await db.refreshShareToken(event.id, 'viewer', req.user.id);
        res.json({ token: result.token, permission: 'viewer' });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /events/:eventId/invite-moderator - Get or create the moderator invite link (one token)
router.post('/:eventId/invite-moderator', auth_1.authenticate, async (req, res) => {
    try {
        const event = await requireEventOwner(req, res);
        if (!event)
            return;
        const result = await db.getOrCreateShareToken(event.id, 'moderator', req.user.id);
        res.json({ token: result.token, permission: 'moderator', created: result.created });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /events/:eventId/invite-moderator/refresh - Revoke moderator token and issue a new one
router.post('/:eventId/invite-moderator/refresh', auth_1.authenticate, async (req, res) => {
    try {
        const event = await requireEventOwner(req, res);
        if (!event)
            return;
        const result = await db.refreshShareToken(event.id, 'moderator', req.user.id);
        res.json({ token: result.token, permission: 'moderator' });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
async function resolveEventPlayer(req, playerId, name) {
    if (playerId) {
        const player = db.getPlayer(playerId);
        if (!player) {
            return { error: 'Player not found', status: 404 };
        }
        const isOwner = req.user && player.ownerId === req.user.id;
        const isModerator = req.shareAccess && req.shareAccess.permission === 'moderator';
        if (!isOwner && !isModerator) {
            return { error: 'Forbidden', status: 403 };
        }
        return player;
    }
    if (name) {
        const userId = req.user?.id;
        const existing = db.findPlayerByName(name) ||
            (userId ? db.findPlayerByDuprId(name, userId) : db.findPlayerByDuprId(name));
        if (existing) {
            return existing;
        }
        if (!userId) {
            return { error: 'Forbidden', status: 403 };
        }
        return await db.createPlayer(name, userId);
    }
    return { error: 'Either player_id or name must be provided', status: 400 };
}
// POST /events/:eventId/teams - Register a fixed partner team
router.post('/:eventId/teams', eventAccess_1.withEventAccess, eventAccess_1.loadEvent, async (req, res) => {
    try {
        const event = req.event;
        if (!event.isFixedPartnerDoubles()) {
            return res.status(400).json({ error: 'This event does not use fixed partner teams' });
        }
        const user = req.user;
        const shareAccess = req.shareAccess;
        const isOwner = user && event.ownerId === user.id;
        const isModerator = shareAccess && shareAccess.eventId === event.id && shareAccess.permission === 'moderator';
        if (!isOwner && !isModerator) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const { player1_id, player1_name, player2_id, player2_name } = req.body;
        const resolved1 = await resolveEventPlayer(req, player1_id, player1_name);
        if ('error' in resolved1) {
            return res.status(resolved1.status).json({ error: resolved1.error });
        }
        const resolved2 = await resolveEventPlayer(req, player2_id, player2_name);
        if ('error' in resolved2) {
            return res.status(resolved2.status).json({ error: resolved2.error });
        }
        if (resolved1.id === resolved2.id) {
            return res.status(400).json({ error: 'A team cannot include the same player twice' });
        }
        if (event.getRegistration(resolved1.id) || event.getRegistration(resolved2.id)) {
            return res.status(409).json({ error: 'One or both players are already registered for this event' });
        }
        event.addTeam(resolved1, resolved2);
        await db.persistEvent(event.id);
        res.status(201).json({
            players: [resolved1, resolved2],
            registrations: [
                event.getRegistration(resolved1.id),
                event.getRegistration(resolved2.id),
            ],
        });
    }
    catch (err) {
        if (err?.message?.includes('same player twice')) {
            return res.status(400).json({ error: err.message });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});
// DELETE /events/:eventId/players/:playerId - Unregister a player from an event (pre-start only, owner or moderator)
router.delete('/:eventId/players/:playerId', eventAccess_1.withEventAccess, eventAccess_1.loadEvent, async (req, res) => {
    try {
        const event = req.event;
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        const user = req.user;
        const shareAccess = req.shareAccess;
        const isOwner = user && event.ownerId === user.id;
        const isModerator = shareAccess && shareAccess.eventId === event.id && shareAccess.permission === 'moderator';
        if (!isOwner && !isModerator) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        if (event.isStarted()) {
            return res.status(400).json({ error: 'Cannot unregister after event has started' });
        }
        event.removePlayer(req.params.playerId);
        await db.persistEvent(event.id);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
//# sourceMappingURL=eventRoutes.js.map