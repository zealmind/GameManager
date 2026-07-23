"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const Database_1 = require("../storage/Database");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const db = Database_1.Database.getInstance();
router.use(auth_1.authenticate);
// POST /players - Create a global player
router.post('/', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Missing required field: name' });
        }
        const player = await db.createPlayer(name, req.user.id);
        res.status(201).json(player);
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /players - List my players
router.get('/', (req, res) => {
    try {
        const players = db.getPlayersByOwner(req.user.id);
        res.json(players);
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /players/:playerId - Retrieve player details
router.get('/:playerId', async (req, res) => {
    try {
        const player = db.getPlayer(req.params.playerId);
        if (!player) {
            return res.status(404).json({ error: 'Player not found' });
        }
        if (player.ownerId !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        res.json(player);
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /events/:eventId/players - Register a player for an event
router.post('/:eventId/players', async (req, res) => {
    try {
        const event = db.getEvent(req.params.eventId);
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        if (event.ownerId !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const { player_id, name } = req.body;
        let player;
        if (player_id) {
            player = db.getPlayer(player_id);
            if (!player) {
                return res.status(404).json({ error: 'Player not found' });
            }
            if (player.ownerId !== req.user.id) {
                return res.status(403).json({ error: 'Forbidden' });
            }
        }
        else if (name) {
            const existing = db.findPlayerByName(name);
            if (existing) {
                player = existing;
            }
            else {
                player = await db.createPlayer(name, req.user.id);
            }
        }
        else {
            return res.status(400).json({ error: 'Either player_id or name must be provided' });
        }
        const existingReg = event.getRegistration(player.id);
        if (existingReg) {
            return res.status(409).json({ error: 'Player already registered for this event' });
        }
        event.addPlayer(player);
        await db.persist();
        res.status(201).json({ player, registration: event.getRegistration(player.id) });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// PATCH /events/:eventId/players/:playerId - Update player status for the event
router.patch('/:eventId/players/:playerId', async (req, res) => {
    try {
        const event = db.getEvent(req.params.eventId);
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }
        if (event.ownerId !== req.user.id) {
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
        const updated = event.updateRegistration(req.params.playerId, { status });
        if (!updated) {
            return res.status(404).json({ error: 'Player registration not found for this event' });
        }
        if (status === 'WAITING') {
            event.recalculateTargetGames();
        }
        await db.persist();
        res.json(updated);
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// DELETE /players/:playerId - Delete a global player
router.delete('/:playerId', async (req, res) => {
    try {
        const player = db.getPlayer(req.params.playerId);
        if (!player) {
            return res.status(404).json({ error: 'Player not found' });
        }
        if (player.ownerId !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        await db.deletePlayer(req.params.playerId);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
//# sourceMappingURL=playerRoutes.js.map