"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const Database_1 = require("../storage/Database");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const db = Database_1.Database.getInstance();
router.use(auth_1.authenticate);
// POST /events - Create a new event
router.post('/', async (req, res) => {
    try {
        const { name, totalGamesToPlay, numCourts } = req.body;
        if (!name || totalGamesToPlay === undefined || numCourts === undefined) {
            return res.status(400).json({ error: 'Missing required fields: name, totalGamesToPlay, numCourts' });
        }
        const ownerId = req.user.id;
        const event = await db.createEvent(name, totalGamesToPlay, numCourts, ownerId);
        res.status(201).json(event);
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /events - List my events
router.get('/', (req, res) => {
    try {
        const events = db.getEventsByOwner(req.user.id);
        res.json(events);
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /events/:eventId - Get event details
router.get('/:eventId', async (req, res) => {
    try {
        const event = db.getEvent(req.params.eventId);
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        if (event.ownerId !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        res.json(event);
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// DELETE /events/:eventId - Delete an event
router.delete('/:eventId', async (req, res) => {
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
// POST /events/:eventId/start - Start an event
router.post('/:eventId/start', async (req, res) => {
    try {
        const event = db.getEvent(req.params.eventId);
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        if (event.ownerId !== req.user.id) {
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
// DELETE /events/:eventId/players/:playerId - Unregister a player from an event (pre-start only)
router.delete('/:eventId/players/:playerId', async (req, res) => {
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