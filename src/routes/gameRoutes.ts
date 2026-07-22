import { Router } from 'express';
import { Database } from '../storage/Database';
import { SchedulingService } from '../services/SchedulingService';

const router = Router();
const db = Database.getInstance();
const schedulingService = new SchedulingService();

// DELETE /events/:eventId/courts/:courtId/allot - Cancel active allotment on a court
router.delete('/:eventId/courts/:courtId/allot', async (req, res) => {
  try {
    const event = db.getEvent(req.params.eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const courtId = parseInt(req.params.courtId, 10);
    const active = event.games.find(g => !g.completed && g.courtId === courtId);
    if (!active) {
      return res.status(404).json({ error: 'No active allotment on this court' });
    }
    if (active.started) {
      return res.status(400).json({ error: 'Cannot cancel after game has started' });
    }
    for (const pid of [...active.players.team1, ...active.players.team2]) {
      const reg = event.getRegistration(pid);
      if (reg) reg.status = 'WAITING';
    }
    event.games = event.games.filter(g => !(!g.completed && g.courtId === courtId));
    await db.persist();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /events/:eventId/schedule - Trigger scheduling of the next game (auto court)
router.post('/:eventId/schedule', async (req, res) => {
  try {
    const event = db.getEvent(req.params.eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
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
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /events/:eventId/courts/:courtId/allot - Allot players for a specific court
router.post('/:eventId/courts/:courtId/allot', async (req, res) => {
  try {
    const event = db.getEvent(req.params.eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
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
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /events/:eventId/games/:gameId/start - Start a game for score entry
router.post('/:eventId/games/:gameId/start', async (req, res) => {
  try {
    const event = db.getEvent(req.params.eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const result = schedulingService.startGame(req.params.eventId, req.params.gameId);
    if (!result.success) {
      return res.status(400).json({ error: result.reason });
    }
    await db.persist();
    res.json(result.game);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /events/:eventId/games/:gameId/end - End a game with score validation
router.post('/:eventId/games/:gameId/end', async (req, res) => {
  try {
    const event = db.getEvent(req.params.eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
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
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /events/:eventId/games/:gameId/score - Submit scores for a game (before end)
router.post('/:eventId/games/:gameId/score', async (req, res) => {
  try {
    const { score_team1, score_team2 } = req.body;
    if (score_team1 === undefined || score_team2 === undefined) {
      return res.status(400).json({ error: 'Both scores are required' });
    }

    const event = db.getEvent(req.params.eventId);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const game = event.games.find(g => g.id === req.params.gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (!game.started) return res.status(400).json({ error: 'Game has not started yet' });
    if (game.completed) return res.status(400).json({ error: 'Game already completed' });

    game.scores = [score_team1, score_team2];
    await db.persist();
    res.json(game);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /events/:eventId/games - List all games for an event
router.get('/:eventId/games', (req, res) => {
  try {
    const event = db.getEvent(req.params.eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.json(event.gameHistory);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /events/:eventId/status - Return current event progression
router.get('/:eventId/status', (req, res) => {
  try {
    const event = db.getEvent(req.params.eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const avgGames = event.getAverageGamesPlayed();
    const availablePlayers = event.getAvailablePlayers();
    const playingPlayersCount = Array.from(event.registrations.values()).filter(r => r.status === 'PLAYING').length;
    const waitingPlayersCount = Array.from(event.registrations.values()).filter(r => r.status === 'WAITING').length;
    const awayPlayersCount = Array.from(event.registrations.values()).filter(r => r.status === 'AWAY').length;
    const retiredPlayersCount = Array.from(event.registrations.values()).filter(r => r.status === 'RETIRED').length;
    const unavailablePlayersCount = Array.from(event.registrations.values()).filter(r => r.status === 'UNAVAILABLE').length;

    const courts: any[] = [];
    for (let c = 1; c <= event.courts; c++) {
      const active = event.games.find(g => !g.completed && g.courtId === c);
      courts.push({
        courtId: c,
        isAvailable: !active,
        game: active ? {
          id: active.id,
          team1: active.players.team1.map(id => ({
            id,
            name: event.players.get(id)?.name || id.slice(0,8)
          })),
          team2: active.players.team2.map(id => ({
            id,
            name: event.players.get(id)?.name || id.slice(0,8)
          })),
          started: active.started,
          scores: active.scores
        } : null
      });
    }

    const activeGames = event.games.filter(g => !g.completed);

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
      isComplete: event.isComplete(),
      isStarted: event.isStarted(),
      startedAt: event.startedAt,
      courts,
      players: Array.from(event.players.values()).map(p => {
        const reg = event.registrations.get(p.id);
        const partnerIds = reg?.partners || [];
        const partnerNames = partnerIds.map(pid => {
          const partner = event.players.get(pid);
          return partner ? partner.nickName || partner.name : pid.slice(0, 8);
        });
        return {
          id: p.id,
          name: p.name,
          nickName: p.nickName,
          gamesPlayed: reg?.gamesPlayedCount || 0,
          status: reg?.status || 'UNKNOWN',
          partners: partnerNames
        };
      }),
      activeGames: activeGames.map(g => ({
        id: g.id,
        courtId: g.courtId,
        team1: {
          ids: g.players.team1,
          names: g.players.team1.map(id => {
            const p = event.players.get(id);
            return p ? p.name : id.slice(0,8);
          })
        },
        team2: {
          ids: g.players.team2,
          names: g.players.team2.map(id => {
            const p = event.players.get(id);
            return p ? p.name : id.slice(0,8);
          })
        },
        started: g.started,
        scores: g.scores
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
