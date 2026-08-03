import { Router } from 'express';
import { Database } from '../storage/Database';
import { SchedulingService } from '../services/SchedulingService';
import { createGame, Game } from '../models/Game';
import { authenticate, AuthenticatedRequest, ShareAccess } from '../middleware/auth';
import { withEventAccess, requireOwnerOrModerator, loadEvent } from '../middleware/eventAccess';

const router = Router();
const db = Database.getInstance();
const schedulingService = new SchedulingService();

function isOwnerOrModerator(event: any, req: any): boolean {
  const user = req.user as { id: string } | undefined;
  const shareAccess = req.shareAccess as ShareAccess | undefined;
  if (user && event.ownerId === user.id) return true;
  if (shareAccess && shareAccess.eventId === event.id && shareAccess.permission === 'moderator') return true;
  return false;
}

// DELETE /events/:eventId/courts/:courtId/allot
router.delete('/:eventId/courts/:courtId/allot', withEventAccess as any, loadEvent as any, async (req: any, res: any) => {
  try {
    const event = req.event;
    if (!isOwnerOrModerator(event, req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const courtId = parseInt(req.params.courtId as string, 10);
    const active = event.games.find((g: Game) => !g.completed && g.courtId === courtId);
    if (!active) {
      return res.status(404).json({ error: 'No active allotment on this court' });
    }

    const result = schedulingService.cancelGame(req.params.eventId as string, active.id);
    if (!result.success) {
      return res.status(400).json({ error: result.reason });
    }

    await db.persistEvent(req.params.eventId as string);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /events/:eventId/schedule
router.post('/:eventId/schedule', withEventAccess as any, loadEvent as any, async (req: any, res: any) => {
  try {
    const event = req.event;
    if (!isOwnerOrModerator(event, req)) {
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

    await db.persistEvent(req.params.eventId as string);
    res.status(201).json({
      ...result.game,
      ...(result.warning ? { warning: result.warning } : {})
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /events/:eventId/end
router.post('/:eventId/end', withEventAccess as any, loadEvent as any, async (req: any, res: any) => {
  try {
    const event = req.event;
    const user = req.user as { id: string } | undefined;
    const shareAccess = req.shareAccess as ShareAccess | undefined;

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
    await db.persistEvent(req.params.eventId as string);
    res.json({ success: true, endedAt: event.endedAt });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /events/:eventId/courts/:courtId/allot-manual
router.post('/:eventId/courts/:courtId/allot-manual', withEventAccess as any, loadEvent as any, async (req: any, res: any) => {
  try {
    const event = req.event;
    if (!isOwnerOrModerator(event, req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!event.isStarted()) {
      return res.status(400).json({ error: 'Event has not started yet' });
    }
    const courtId = parseInt(req.params.courtId as string, 10);
    const alreadyActive = event.games.find((g: Game) => !g.completed && g.courtId === courtId);
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

    if (team1Clean.length + team2Clean.length < 4) {
      const result = schedulingService.completePartialGame(req.params.eventId as string, courtId, team1Clean, team2Clean);
      if (!result.success || !result.game) {
        return res.status(409).json({
          error: result.reason,
          blockingConstraints: result.blockingConstraints
        });
      }
      // completePartialGame already set PLAYING and pushed the game
      await db.persistEvent(req.params.eventId as string);
      return res.status(201).json({
        ...result.game,
        ...(result.warning ? { warning: result.warning } : {})
      });
    }

    const game = createGame(req.params.eventId as string, courtId, team1Clean, team2Clean);
    const allGamePlayers = [...game.players.team1, ...game.players.team2];
    for (const pid of allGamePlayers) {
      event.updateRegistration(pid, { status: 'PLAYING' });
    }

    event.games.push(game);
    await db.persistEvent(req.params.eventId as string);
    res.status(201).json(game);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /events/:eventId/courts/:courtId/allot
router.post('/:eventId/courts/:courtId/allot', withEventAccess as any, loadEvent as any, async (req: any, res: any) => {
  try {
    const event = req.event;
    if (!isOwnerOrModerator(event, req)) {
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

    await db.persistEvent(req.params.eventId as string);
    res.status(201).json({
      ...result.game,
      ...(result.warning ? { warning: result.warning } : {})
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /events/:eventId/games/:gameId/start
router.post('/:eventId/games/:gameId/start', withEventAccess as any, loadEvent as any, async (req: any, res: any) => {
  try {
    const event = req.event;
    if (!isOwnerOrModerator(event, req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = schedulingService.startGame(req.params.eventId as string, req.params.gameId as string);
    await db.persistEvent(req.params.eventId as string);
    if (!result.success) {
      return res.status(400).json({ error: result.reason });
    }
    res.json(result.game);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /events/:eventId/games/:gameId/end
router.post('/:eventId/games/:gameId/end', withEventAccess as any, loadEvent as any, async (req: any, res: any) => {
  try {
    const event = req.event;
    if (!isOwnerOrModerator(event, req)) {
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
    await db.persistEvent(req.params.eventId as string);
    res.json(result.game);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /events/:eventId/games/:gameId/score
router.post('/:eventId/games/:gameId/score', withEventAccess as any, loadEvent as any, async (req: any, res: any) => {
  try {
    const { score_team1, score_team2 } = req.body;
    if (score_team1 === undefined || score_team2 === undefined) {
      return res.status(400).json({ error: 'Both scores are required' });
    }

    const event = req.event;
    if (!isOwnerOrModerator(event, req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const gameId = req.params.gameId as string;
    const scores: [number, number] = [Number(score_team1), Number(score_team2)];
    const activeGame = event.games.find((g: Game) => g.id === gameId);
    const historyGame = event.gameHistory.find((g: Game) => g.id === gameId);

    // In-progress game: update live scores
    if (activeGame && !activeGame.completed) {
      if (!activeGame.started) return res.status(400).json({ error: 'Game has not started yet' });
      activeGame.scores = scores;
      await db.persistEvent(req.params.eventId as string);
      return res.json(activeGame);
    }

    // Completed game: update history (and any leftover active copy)
    const completedGame = historyGame || (activeGame?.completed ? activeGame : null);
    if (!completedGame) return res.status(404).json({ error: 'Game not found' });

    completedGame.scores = scores;
    if (historyGame) historyGame.scores = scores;
    if (activeGame?.completed) activeGame.scores = scores;

    await db.persistEvent(req.params.eventId as string);
    res.json(completedGame);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /events/:eventId/games
router.get('/:eventId/games', withEventAccess as any, loadEvent as any, async (req: any, res: any) => {
  try {
    const event = req.event;
    const shareAccess = req.shareAccess as ShareAccess | undefined;

    if (shareAccess && shareAccess.eventId === event.id) {
      return res.json(event.gameHistory);
    }

    return res.json(event.gameHistory);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /events/:eventId/status
router.get('/:eventId/status', withEventAccess as any, loadEvent as any, async (req: any, res: any) => {
  try {
    const event = req.event;

    if (event.isStarted() && event.assignNickNames()) {
      await db.persistEvent(req.params.eventId as string);
    }

    const avgGames = event.getAverageGamesPlayed();
    const availablePlayers = event.getAvailablePlayers();
    const playingPlayersCount = Array.from(event.registrations.values()).filter((r: any) => r.status === 'PLAYING').length;
    const waitingPlayersCount = Array.from(event.registrations.values()).filter((r: any) => r.status === 'WAITING').length;
    const awayPlayersCount = Array.from(event.registrations.values()).filter((r: any) => r.status === 'AWAY').length;
    const retiredPlayersCount = Array.from(event.registrations.values()).filter((r: any) => r.status === 'RETIRED').length;
    const unavailablePlayersCount = Array.from(event.registrations.values()).filter((r: any) => r.status === 'UNAVAILABLE').length;
    const fulfilledPlayersCount = Array.from(event.registrations.values()).filter((r: any) => r.gamesPlayedCount >= r.targetGames).length;

    const courts: any[] = [];
    for (let c = 1; c <= event.courts; c++) {
      const active = event.games.find((g: Game) => !g.completed && g.courtId === c);
      courts.push({
        courtId: c,
        isAvailable: !active,
        game: active ? {
          id: active.id,
           team1: active.players.team1.map((id: string) => ({
             id,
             name: event.players.get(id)?.name || id.slice(0,8)
           })),
           team2: active.players.team2.map((id: string) => ({
             id,
             name: event.players.get(id)?.name || id.slice(0,8)
           })),
          started: active.started,
          scores: active.scores,
          allotmentWarning: active.allotmentWarning || null
        } : null
      });
    }

    const activeGames = event.games.filter((g: Game) => !g.completed);

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
      players: Array.from(event.players.values()).map((p: any) => {
        const reg = event.registrations.get(p.id);
        const partnerIds = reg?.partners || [];
        const partnerNames = partnerIds.map((pid: string) => {
          const partner = event.players.get(pid);
          return partner ? partner.name : pid.slice(0, 8);
        });
        return {
          id: p.id,
          name: p.name,
          nickName: reg?.nickName,
          duprId: p.duprId,
          gamesPlayed: reg?.gamesPlayedCount || 0,
          targetGames: reg?.targetGames || 0,
          status: reg?.status || 'UNKNOWN',
          partners: partnerNames,
          partnerIds
        };
      }),
      activeGames: activeGames.map((g: Game) => ({
        id: g.id,
        courtId: g.courtId,
        team1: {
          ids: g.players.team1,
          names: g.players.team1.map((id: string) => {
            const p = event.players.get(id);
            return p ? p.name : id.slice(0,8);
          })
        },
        team2: {
          ids: g.players.team2,
          names: g.players.team2.map((id: string) => {
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
