"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const Database_1 = require("../storage/Database");
const router = (0, express_1.Router)();
const db = Database_1.Database.getInstance();
// POST /players - Create a global player
router.post('/', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Missing required field: name' });
        }
        const player = await db.createPlayer(name);
        res.status(201).json(player);
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /players - List all players
router.get('/', (req, res) => {
    try {
        const players = db.getAllPlayers();
        res.json(players);
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /players/:playerId - Retrieve player details
router.get('/:playerId', (req, res) => {
    try {
        const player = db.getPlayer(req.params.playerId);
        if (!player) {
            return res.status(404).json({ error: 'Player not found' });
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
        const { player_id, name } = req.body;
        let player;
        if (player_id) {
            player = db.getPlayer(player_id);
            if (!player) {
                return res.status(404).json({ error: 'Player not found' });
            }
        }
        else if (name) {
            const existing = db.findPlayerByName(name);
            if (existing) {
                player = existing;
            }
            else {
                player = await db.createPlayer(name);
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
        await db.deletePlayer(req.params.playerId);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
//# sourceMappingURL=playerRoutes.js.map