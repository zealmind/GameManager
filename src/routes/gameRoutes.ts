import { Router } from 'express';
import { Database } from '../storage/Database';
import { SchedulingService } from '../services/SchedulingService';
import { createGame } from '../models/Game';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

const router = Router();
const db = Database.getInstance();
const schedulingService = new SchedulingService();

router.use(authenticate);

// DELETE /events/:eventId/courts/:courtId/allot - Cancel active allotment on a court
router.delete('/:eventId/courts/:courtId/allot', async (req: AuthenticatedRequest, res) => {
  try {
    const event = db.getEvent(req.params.eventId as string);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if ((event as any).ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const courtId = parseInt(req.params.courtId as string, 10);
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
router.post('/:eventId/schedule', async (req: AuthenticatedRequest, res) => {
  try {
    const event = db.getEvent(req.params.eventId as string);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if ((event as any).ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = schedulingService.assignNextGame(req.params.eventId as string, 1);
    
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

// POST /events/:eventId/end - End an event manually
router.post('/:eventId/end', async (req: AuthenticatedRequest, res) => {
  try {
    const event = db.getEvent(req.params.eventId as string);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if ((event as any).ownerId !== req.user!.id) {
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
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /events/:eventId/courts/:courtId/allot-manual - Manual allotment with specific players
router.post('/:eventId/courts/:courtId/allot-manual', async (req: AuthenticatedRequest, res) => {
  try {
    const event = db.getEvent(req.params.eventId as string);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if ((event as any).ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!event.isStarted()) {
      return res.status(400).json({ error: 'Event has not started yet' });
    }
    const courtId = parseInt(req.params.courtId as string, 10);
    const alreadyActive = event.games.find(g => !g.completed && g.courtId === courtId);
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
      const result = schedulingService.completePartialGame(req.params.eventId as string, courtId, team1Clean, team2Clean);
      if (!result.success || !result.game) {
        return res.status(409).json({
          error: result.reason,
          blockingConstraints: result.blockingConstraints
        });
      }
      game = result.game;
    } else {
      game = createGame(req.params.eventId as string, courtId, team1Clean, team2Clean);
    }

    const allGamePlayers = [...game.players.team1, ...game.players.team2];
    for (const pid of allGamePlayers) {
      event.updateRegistration(pid, { status: 'PLAYING' });
    }

    event.games.push(game);
    await db.persist();
    res.status(201).json(game);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /events/:eventId/courts/:courtId/allot - Allot players for a specific court
router.post('/:eventId/courts/:courtId/allot', async (req: AuthenticatedRequest, res) => {
  try {
    const event = db.getEvent(req.params.eventId as string);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if ((event as any).ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!event.isStarted()) {
      return res.status(400).json({ error: 'Event has not started yet' });
    }
    const courtId = parseInt(req.params.courtId as string, 10);
    const result = schedulingService.assignNextGame(req.params.eventId as string, courtId);
    
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
router.post('/:eventId/games/:gameId/start', async (req: AuthenticatedRequest, res) => {
  try {
    const event = db.getEvent(req.params.eventId as string);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if ((event as any).ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = schedulingService.startGame(req.params.eventId as string, req.params.gameId as string);
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
router.post('/:eventId/games/:gameId/end', async (req: AuthenticatedRequest, res) => {
  try {
    const event = db.getEvent(req.params.eventId as string);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if ((event as any).ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { score_team1, score_team2 } = req.body || {};
    const result = schedulingService.endGame(req.params.eventId as string, req.params.gameId as string, {
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
router.post('/:eventId/games/:gameId/score', async (req: AuthenticatedRequest, res) => {
  try {
    const { score_team1, score_team2 } = req.body;
    if (score_team1 === undefined || score_team2 === undefined) {
      return res.status(400).json({ error: 'Both scores are required' });
    }

    const event = db.getEvent(req.params.eventId as string);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if ((event as any).ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const game = event.games.find(g => g.id === req.params.gameId as string);
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
router.get('/:eventId/games', async (req: AuthenticatedRequest, res) => {
  try {
    const event = db.getEvent(req.params.eventId as string);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if ((event as any).ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(event.gameHistory);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /events/:eventId/status - Return current event progression
router.get('/:eventId/status', async (req: AuthenticatedRequest, res) => {
  try {
    const event = db.getEvent(req.params.eventId as string);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if ((event as any).ownerId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const avgGames = event.getAverageGamesPlayed();
    const availablePlayers = event.getAvailablePlayers();
    const playingPlayersCount = Array.from(event.registrations.values()).filter(r => r.status === 'PLAYING').length;
    const waitingPlayersCount = Array.from(event.registrations.values()).filter(r => r.status === 'WAITING').length;
    const awayPlayersCount = Array.from(event.registrations.values()).filter(r => r.status === 'AWAY').length;
    const retiredPlayersCount = Array.from(event.registrations.values()).filter(r => r.status === 'RETIRED').length;
    const unavailablePlayersCount = Array.from(event.registrations.values()).filter(r => r.status === 'UNAVAILABLE').length;
    const fulfilledPlayersCount = Array.from(event.registrations.values()).filter(r => r.gamesPlayedCount >= r.targetGames).length;

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
      fulfilledPlayers: fulfilledPlayersCount,
      isComplete: event.isComplete(),
      isStarted: event.isStarted(),
      startedAt: event.startedAt,
      isEnded: event.isEnded(),
      endedAt: event.endedAt,
      courts,
      players: Array.from(event.players.values()).map(p => {
        const reg = event.registrations.get(p.id);
        const partnerIds = reg?.partners || [];
        const partnerNames = partnerIds.map(pid => {
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
