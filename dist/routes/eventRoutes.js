"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const Database_1 = require("../storage/Database");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const db = Database_1.Database.getInstance();
function withAccess(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : req.cookies?.token;
    if (token) {
        return (0, auth_1.authenticate)(req, res, next);
    }
    const share = req.headers['x-share-token'];
    if (typeof share === 'string') {
        const access = db.resolveShareToken(share);
        if (access) {
            req.shareAccess = access;
            return next();
        }
    }
    return res.status(401).json({ error: 'Unauthorized' });
}
function requireOwner(req, res, next) {
    const event = db.getEvent(req.params.eventId);
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    if (event.ownerId !== req.user?.id) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    req.event = event;
    next();
}
function requireOwnerOrModerator(req, res, next) {
    const event = db.getEvent(req.params.eventId);
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    const user = req.user;
    const shareAccess = req.shareAccess;
    if (user && event.ownerId === user.id) {
        req.event = event;
        return next();
    }
    if (shareAccess && shareAccess.eventId === event.id) {
        req.event = event;
        req.sharePermission = shareAccess.permission;
        return next();
    }
    return res.status(403).json({ error: 'Forbidden' });
}
function prepareEventResponse(event) {
    const ev = event;
    return {
        id: event.id,
        name: event.name,
        courts: event.courts,
        totalGamesToPlay: event.totalGamesToPlay,
        startedAt: event.startedAt,
        endedAt: event.endedAt,
        ownerId: ev.ownerId,
        players: Array.from(event.players.values()).map((p) => ({ id: p.id, name: p.name, ownerId: p.ownerId })),
        registrations: Array.from(event.registrations.values()),
        games: event.games,
        gameHistory: event.gameHistory,
        sharedAccess: event.sharedAccess
    };
}
// POST /events - Create a new event
router.post('/', auth_1.authenticate, async (req, res) => {
    try {
        const { name, totalGamesToPlay, numCourts } = req.body;
        if (!name || totalGamesToPlay === undefined || numCourts === undefined) {
            return res.status(400).json({ error: 'Missing required fields: name, totalGamesToPlay, numCourts' });
        }
        const ownerId = req.user.id;
        const event = await db.createEvent(name, totalGamesToPlay, numCourts, ownerId);
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
router.get('/:eventId', withAccess, async (req, res) => {
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
// DELETE /events/:eventId - Delete an event (owner only, and no shared access)
router.delete('/:eventId', auth_1.authenticate, async (req, res) => {
    try {
        const event = db.getEvent(req.params.eventId);
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        if (event.ownerId !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        if ((event.sharedAccess || []).length > 0) {
            return res.status(400).json({ error: 'Cannot delete an event that has been shared' });
        }
        await db.deleteEvent(req.params.eventId);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /events/:eventId/start - Start an event (owner or moderator)
router.post('/:eventId/start', withAccess, async (req, res) => {
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
        event.start();
        await db.persist();
        res.json({ success: true, startedAt: event.startedAt });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /events/:eventId/share - Generate a viewer share link
router.post('/:eventId/share', auth_1.authenticate, async (req, res) => {
    try {
        const event = db.getEvent(req.params.eventId);
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        if (event.ownerId !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const result = await db.generateShareToken(event.id, 'viewer', req.user.id);
        res.json({ token: result.token, permission: 'viewer' });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /events/:eventId/invite-moderator - Generate a moderator invite link
router.post('/:eventId/invite-moderator', auth_1.authenticate, async (req, res) => {
    try {
        const event = db.getEvent(req.params.eventId);
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        if (event.ownerId !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const result = await db.generateShareToken(event.id, 'moderator', req.user.id);
        res.json({ token: result.token, permission: 'moderator' });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// DELETE /events/:eventId/players/:playerId - Unregister a player from an event (pre-start only, owner only)
router.delete('/:eventId/players/:playerId', auth_1.authenticate, async (req, res) => {
    try {
        const event = db.getEvent(req.params.eventId);
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        if (event.ownerId !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        if (event.isStarted()) {
            return res.status(400).json({ error: 'Cannot unregister after event has started' });
        }
        event.removePlayer(req.params.playerId);
        await db.persist();
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
//# sourceMappingURL=eventRoutes.js.map