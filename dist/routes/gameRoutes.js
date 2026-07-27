"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const Database_1 = require("../storage/Database");
const SchedulingService_1 = require("../services/SchedulingService");
const Game_1 = require("../models/Game");
const eventAccess_1 = require("../middleware/eventAccess");
const router = (0, express_1.Router)();
const db = Database_1.Database.getInstance();
const schedulingService = new SchedulingService_1.SchedulingService();
function isOwnerOrModerator(event, req) {
    const user = req.user;
    const shareAccess = req.shareAccess;
    if (user && event.ownerId === user.id)
        return true;
    if (shareAccess && shareAccess.eventId === event.id && shareAccess.permission === 'moderator')
        return true;
    return false;
}
// DELETE /events/:eventId/courts/:courtId/allot
router.delete('/:eventId/courts/:courtId/allot', eventAccess_1.withEventAccess, eventAccess_1.loadEvent, async (req, res) => {
    try {
        const event = req.event;
        if (!isOwnerOrModerator(event, req)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const courtId = parseInt(req.params.courtId, 10);
        const active = event.games.find((g) => !g.completed && g.courtId === courtId);
        if (!active) {
            return res.status(404).json({ error: 'No active allotment on this court' });
        }
        const result = schedulingService.cancelGame(req.params.eventId, active.id);
        if (!result.success) {
            return res.status(400).json({ error: result.reason });
        }
        await db.persist();
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /events/:eventId/schedule
router.post('/:eventId/schedule', eventAccess_1.withEventAccess, eventAccess_1.loadEvent, async (req, res) => {
    try {
        const event = req.event;
        if (!isOwnerOrModerator(event, req)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const result = schedulingService.assignNextGame(req.params.eventId, 1);
        if (!result.success) {
            if (result.shouldWait) {
                return res.status(200).json({
                    message: result.reason,
                    blockingConstraints: result.blockingConstraints,
                    status: 'WAITING'
                });
            }
            return res.status(409).json({
                error: result.reason,
                blockingConstraints: result.blockingConstraints
            });
        }
        await db.persist();
        res.status(201).json(result.game);
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /events/:eventId/end
router.post('/:eventId/end', eventAccess_1.withEventAccess, eventAccess_1.loadEvent, async (req, res) => {
    try {
        const event = req.event;
        const user = req.user;
        const shareAccess = req.shareAccess;
        const isOwner = user && event.ownerId === user.id;
        const isModerator = shareAccess && shareAccess.eventId === event.id && shareAccess.permission === 'moderator';
        if (!isOwner) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        if (!event.isStarted()) {
            return res.status(400).json({ error: 'Event has not started yet' });
        }
        if (event.isEnded()) {
            return res.status(400).json({ error: 'Event has already been ended' });
        }
        event.endedAt = new Date();
        await db.persist();
        res.json({ success: true, endedAt: event.endedAt });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /events/:eventId/courts/:courtId/allot-manual
router.post('/:eventId/courts/:courtId/allot-manual', eventAccess_1.withEventAccess, eventAccess_1.loadEvent, async (req, res) => {
    try {
        const event = req.event;
        if (!isOwnerOrModerator(event, req)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        if (!event.isStarted()) {
            return res.status(400).json({ error: 'Event has not started yet' });
        }
        const courtId = parseInt(req.params.courtId, 10);
        const alreadyActive = event.games.find((g) => !g.completed && g.courtId === courtId);
        if (alreadyActive) {
            return res.status(400).json({ error: `Court ${courtId} is already allotted` });
        }
        const { team1, team2 } = req.body || {};
        if ((!team1 || !Array.isArray(team1) || team1.length < 1) &&
            (!team2 || !Array.isArray(team2) || team2.length < 1)) {
            return res.status(400).json({ error: 'Must provide at least 1 player in team1 or team2' });
        }
        const allPlayerIds = [...team1, ...team2].filter(Boolean);
        if (new Set(allPlayerIds).size !== allPlayerIds.length) {
            return res.status(400).json({ error: 'All players must be distinct' });
        }
        for (const pid of allPlayerIds) {
            const reg = event.getRegistration(pid);
            if (!reg) {
                return res.status(400).json({ error: `Player is not registered for this event` });
            }
            if (reg.status !== 'WAITING') {
                return res.status(400).json({ error: `Player is not available (status: ${reg.status})` });
            }
        }
        const team1Clean = team1.filter(Boolean);
        const team2Clean = team2.filter(Boolean);
        let game;
        if (team1Clean.length + team2Clean.length < 4) {
            const result = schedulingService.completePartialGame(req.params.eventId, courtId, team1Clean, team2Clean);
            if (!result.success || !result.game) {
                return res.status(409).json({
                    error: result.reason,
                    blockingConstraints: result.blockingConstraints
                });
            }
            game = result.game;
        }
        else {
            game = (0, Game_1.createGame)(req.params.eventId, courtId, team1Clean, team2Clean);
        }
        const allGamePlayers = [...game.players.team1, ...game.players.team2];
        for (const pid of allGamePlayers) {
            event.updateRegistration(pid, { status: 'PLAYING' });
        }
        event.games.push(game);
        await db.persist();
        res.status(201).json(game);
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /events/:eventId/courts/:courtId/allot
router.post('/:eventId/courts/:courtId/allot', eventAccess_1.withEventAccess, eventAccess_1.loadEvent, async (req, res) => {
    try {
        const event = req.event;
        if (!isOwnerOrModerator(event, req)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        if (!event.isStarted()) {
            return res.status(400).json({ error: 'Event has not started yet' });
        }
        const courtId = parseInt(req.params.courtId, 10);
        const result = schedulingService.assignNextGame(req.params.eventId, courtId);
        if (!result.success) {
            if (result.shouldWait) {
                return res.status(200).json({
                    message: result.reason,
                    blockingConstraints: result.blockingConstraints,
                    status: 'WAITING'
                });
            }
            return res.status(409).json({
                error: result.reason,
                blockingConstraints: result.blockingConstraints
            });
        }
        await db.persist();
        res.status(201).json(result.game);
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /events/:eventId/games/:gameId/start
router.post('/:eventId/games/:gameId/start', eventAccess_1.withEventAccess, eventAccess_1.loadEvent, async (req, res) => {
    try {
        const event = req.event;
        if (!isOwnerOrModerator(event, req)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const result = schedulingService.startGame(req.params.eventId, req.params.gameId);
        if (!result.success) {
            return res.status(400).json({ error: result.reason });
        }
        await db.persist();
        res.json(result.game);
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /events/:eventId/games/:gameId/end
router.post('/:eventId/games/:gameId/end', eventAccess_1.withEventAccess, eventAccess_1.loadEvent, async (req, res) => {
    try {
        const event = req.event;
        if (!isOwnerOrModerator(event, req)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const { score_team1, score_team2 } = req.body || {};
        const result = schedulingService.endGame(req.params.eventId, req.params.gameId, {
            score_team1: score_team1 !== undefined ? Number(score_team1) : undefined,
            score_team2: score_team2 !== undefined ? Number(score_team2) : undefined
        });
        if (!result.success) {
            return res.status(400).json({ error: result.reason, blockingConstraints: result.blockingConstraints });
        }
        await db.persist();
        res.json(result.game);
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /events/:eventId/games/:gameId/score
router.post('/:eventId/games/:gameId/score', eventAccess_1.withEventAccess, eventAccess_1.loadEvent, async (req, res) => {
    try {
        const { score_team1, score_team2 } = req.body;
        if (score_team1 === undefined || score_team2 === undefined) {
            return res.status(400).json({ error: 'Both scores are required' });
        }
        const event = req.event;
        if (!isOwnerOrModerator(event, req)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const game = event.games.find((g) => g.id === req.params.gameId);
        if (!game)
            return res.status(404).json({ error: 'Game not found' });
        if (!game.started)
            return res.status(400).json({ error: 'Game has not started yet' });
        if (game.completed)
            return res.status(400).json({ error: 'Game already completed' });
        game.scores = [score_team1, score_team2];
        await db.persist();
        res.json(game);
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /events/:eventId/games
router.get('/:eventId/games', eventAccess_1.withEventAccess, eventAccess_1.loadEvent, async (req, res) => {
    try {
        const event = req.event;
        const shareAccess = req.shareAccess;
        if (shareAccess && shareAccess.eventId === event.id) {
            return res.json(event.gameHistory);
        }
        return res.json(event.gameHistory);
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /events/:eventId/status
router.get('/:eventId/status', eventAccess_1.withEventAccess, eventAccess_1.loadEvent, async (req, res) => {
    try {
        const event = req.event;
        const avgGames = event.getAverageGamesPlayed();
        const availablePlayers = event.getAvailablePlayers();
        const playingPlayersCount = Array.from(event.registrations.values()).filter((r) => r.status === 'PLAYING').length;
        const waitingPlayersCount = Array.from(event.registrations.values()).filter((r) => r.status === 'WAITING').length;
        const awayPlayersCount = Array.from(event.registrations.values()).filter((r) => r.status === 'AWAY').length;
        const retiredPlayersCount = Array.from(event.registrations.values()).filter((r) => r.status === 'RETIRED').length;
        const unavailablePlayersCount = Array.from(event.registrations.values()).filter((r) => r.status === 'UNAVAILABLE').length;
        const fulfilledPlayersCount = Array.from(event.registrations.values()).filter((r) => r.gamesPlayedCount >= r.targetGames).length;
        const courts = [];
        for (let c = 1; c <= event.courts; c++) {
            const active = event.games.find((g) => !g.completed && g.courtId === c);
            courts.push({
                courtId: c,
                isAvailable: !active,
                game: active ? {
                    id: active.id,
                    team1: active.players.team1.map((id) => ({
                        id,
                        name: event.players.get(id)?.name || id.slice(0, 8)
                    })),
                    team2: active.players.team2.map((id) => ({
                        id,
                        name: event.players.get(id)?.name || id.slice(0, 8)
                    })),
                    started: active.started,
                    scores: active.scores
                } : null
            });
        }
        const activeGames = event.games.filter((g) => !g.completed);
        res.json({
            eventId: event.id,
            eventName: event.name,
            totalGamesToPlay: event.totalGamesToPlay,
            gamesPlayed: event.gameHistory.length,
            gamesRemaining: event.totalGamesToPlay - event.gameHistory.length,
            averageGamesPlayed: avgGames,
            availablePlayers: availablePlayers.length,
            waitingPlayers: waitingPlayersCount,
            playingPlayers: playingPlayersCount,
            awayPlayers: awayPlayersCount,
            retiredPlayers: retiredPlayersCount,
            unavailablePlayers: unavailablePlayersCount,
            fulfilledPlayers: fulfilledPlayersCount,
            isComplete: event.isComplete(),
            isStarted: event.isStarted(),
            startedAt: event.startedAt,
            isEnded: event.isEnded(),
            endedAt: event.endedAt,
            courts,
            players: Array.from(event.players.values()).map((p) => {
                const reg = event.registrations.get(p.id);
                const partnerIds = reg?.partners || [];
                const partnerNames = partnerIds.map((pid) => {
                    const partner = event.players.get(pid);
                    return partner ? partner.name : pid.slice(0, 8);
                });
                return {
                    id: p.id,
                    name: p.name,
                    gamesPlayed: reg?.gamesPlayedCount || 0,
                    targetGames: reg?.targetGames || 0,
                    status: reg?.status || 'UNKNOWN',
                    partners: partnerNames,
                    partnerIds
                };
            }),
            activeGames: activeGames.map((g) => ({
                id: g.id,
                courtId: g.courtId,
                team1: {
                    ids: g.players.team1,
                    names: g.players.team1.map((id) => {
                        const p = event.players.get(id);
                        return p ? p.name : id.slice(0, 8);
                    })
                },
                team2: {
                    ids: g.players.team2,
                    names: g.players.team2.map((id) => {
                        const p = event.players.get(id);
                        return p ? p.name : id.slice(0, 8);
                    })
                },
                started: g.started,
                scores: g.scores
            }))
        });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
//# sourceMappingURL=gameRoutes.js.map