import { Database } from '../storage/Database';
import { SchedulingService } from '../services/SchedulingService';
import { isValidGameScore } from '../utils/scoreValidation';

const DEFAULT_OWNER = 'test-owner-0000-0000-0000-000000000000';

describe('Pickleball Event Scheduler Validation', () => {
  let db: Database;
  let scheduler: SchedulingService;

  beforeEach(async () => {
    db = Database.getInstance();
    await db.clear();
    scheduler = new SchedulingService();
  });

  it('should not schedule with fewer than 3 players', async () => {
    const event = await db.createEvent('Test Event', 18, 3, DEFAULT_OWNER);
    
    const player = await db.createPlayer('Player 1', DEFAULT_OWNER);
    event.addPlayer(player);
    
    const result = scheduler.assignNextGame(event.id, 1);
    expect(result.success).toBe(false);
    expect(result.shouldWait).toBe(true);
    expect(result.blockingConstraints).toBeDefined();
    expect(result.blockingConstraints?.length).toBeGreaterThan(0);
  });

  it('should allot with a warning when all available players have already partnered', async () => {
    const event = await db.createEvent('Test Event', 10, 2, DEFAULT_OWNER);
    
    const players = [];
    for (let i = 1; i <= 4; i++) {
      const player = await db.createPlayer(`Player ${i}`, DEFAULT_OWNER);
      event.addPlayer(player);
      players.push(player);
    }
    
    const regs = players.map(p => event.getRegistration(p.id)!);
    
    regs[0].partners = [regs[1].playerId, regs[2].playerId, regs[3].playerId];
    regs[1].partners = [regs[0].playerId, regs[2].playerId, regs[3].playerId];
    regs[2].partners = [regs[0].playerId, regs[1].playerId, regs[3].playerId];
    regs[3].partners = [regs[0].playerId, regs[1].playerId, regs[2].playerId];
    
    const result = scheduler.assignNextGame(event.id, 1);
    expect(result.success).toBe(true);
    expect(result.game).toBeDefined();
    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/repeat partners/i);
  });

  it('should warn when allotment would raise co-play counts to 3+', async () => {
    const event = await db.createEvent('Test Event', 10, 2, DEFAULT_OWNER);

    const players = [];
    for (let i = 1; i <= 4; i++) {
      const player = await db.createPlayer(`Player ${i}`, DEFAULT_OWNER);
      event.addPlayer(player);
      players.push(player);
    }
    const ids = players.map(p => p.id);

    // Every pair among the 4 already shared a court twice → next game makes 3s
    for (let n = 0; n < 2; n++) {
      event.gameHistory.push({
        id: `hist-${n}`,
        eventId: event.id,
        gameNumber: n + 1,
        courtId: 1,
        players: { team1: [ids[0], ids[1]], team2: [ids[2], ids[3]] },
        createdAt: new Date(),
        completed: true,
        started: true,
      } as any);
    }

    for (const id of ids) {
      const reg = event.getRegistration(id)!;
      reg.gamesPlayedCount = 2;
      reg.priority = 5;
      reg.targetGames = 10;
      reg.partners = [];
    }

    const result = scheduler.assignNextGame(event.id, 1);
    expect(result.success).toBe(true);
    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/3\+/);
    expect(result.game?.allotmentWarning).toBe(result.warning);
  });

  it('should prefer unique partners over higher-priority repeat-partner groupings', async () => {
    const event = await db.createEvent('Test Event', 10, 2, DEFAULT_OWNER);

    const players = [];
    for (let i = 1; i <= 6; i++) {
      const player = await db.createPlayer(`Player ${i}`, DEFAULT_OWNER);
      event.addPlayer(player);
      players.push(player);
    }
    const ids = players.map(p => p.id);

    // High-priority players 0-3 have all partnered with each other already
    for (let i = 0; i < 4; i++) {
      const reg = event.getRegistration(ids[i])!;
      reg.gamesPlayedCount = 1;
      reg.priority = 7;
      reg.targetGames = 10;
      reg.partners = ids.filter((_, j) => j < 4 && j !== i);
    }
    // Lower-priority players 4-5 are fresh and can form unique partnerships with anyone
    for (let i = 4; i < 6; i++) {
      const reg = event.getRegistration(ids[i])!;
      reg.gamesPlayedCount = 1;
      reg.priority = 5;
      reg.targetGames = 10;
      reg.partners = [];
    }

    const result = scheduler.assignNextGame(event.id, 1);
    expect(result.success).toBe(true);
    expect(result.warning).toBeUndefined();

    const t1 = result.game!.players.team1;
    const t2 = result.game!.players.team2;
    expect(scheduler.hasPlayedTogether(t1[0], t1[1], event)).toBe(false);
    expect(scheduler.hasPlayedTogether(t2[0], t2[1], event)).toBe(false);
  });

  it('should prefer groupings that fill unused co-play pairs over high-repeat courts', async () => {
    const event = await db.createEvent('Test Event', 10, 2, DEFAULT_OWNER);

    const players = [];
    for (let i = 1; i <= 6; i++) {
      const player = await db.createPlayer(`Player ${i}`, DEFAULT_OWNER);
      event.addPlayer(player);
      players.push(player);
    }
    const ids = players.map(p => p.id);

    // Simulate history: players 0-3 have shared courts heavily; 4-5 are fresh faces
    for (let n = 0; n < 3; n++) {
      event.gameHistory.push({
        id: `hist-${n}`,
        eventId: event.id,
        gameNumber: n + 1,
        courtId: 1,
        players: { team1: [ids[0], ids[1]], team2: [ids[2], ids[3]] },
        createdAt: new Date(),
        completed: true,
        started: true,
      } as any);
    }

    // Mark equal priority / games so matrix score decides among top candidates
    for (const id of ids) {
      const reg = event.getRegistration(id)!;
      reg.gamesPlayedCount = 1;
      reg.priority = 5;
      reg.targetGames = 10;
    }

    const result = scheduler.assignNextGame(event.id, 1);
    expect(result.success).toBe(true);
    const allotted = new Set([
      ...result.game!.players.team1,
      ...result.game!.players.team2,
    ]);
    // Fresh players 4 and 5 should be preferred to avoid stacking 0-3 again
    expect(allotted.has(ids[4])).toBe(true);
    expect(allotted.has(ids[5])).toBe(true);
  });

  it('should form 1v2 game when 3 players are available and 2v2 pairing fails', async () => {
    const event = await db.createEvent('Test Event', 10, 2, DEFAULT_OWNER);
    
    const players = [];
    for (let i = 1; i <= 3; i++) {
      const player = await db.createPlayer(`Player ${i}`, DEFAULT_OWNER);
      event.addPlayer(player);
      players.push(player);
    }
    
    const result = scheduler.assignNextGame(event.id, 1);
    expect(result.success).toBe(true);
    expect(result.game).toBeDefined();
    const game = result.game!;
    expect(game.players.team1.length + game.players.team2.length).toBe(3);
  });

  it('should schedule games with 12 players, aiming for minimum 6 games each', async () => {
    const event = await db.createEvent('Test Event', 6, 3, DEFAULT_OWNER);
    
    const playerIds: string[] = [];
    for (let i = 1; i <= 12; i++) {
      const player = await db.createPlayer(`Player ${i}`, DEFAULT_OWNER);
      event.addPlayer(player);
      playerIds.push(player.id);
    }
    
    const maxScheduleAttempts = 30;
    let gamesScheduled = 0;
    
    for (let attempt = 0; attempt < maxScheduleAttempts * 2 && gamesScheduled < maxScheduleAttempts; attempt++) {
      const result = scheduler.assignNextGame(event.id, 1);
      
      if (!result.success) {
        if (result.shouldWait) {
          break;
        }
        fail(`Unexpected scheduling failure: ${result.reason}`);
      }
      
      if (result.game) {
        result.game.scores = [11, 7];
        scheduler.startGame(event.id, result.game.id);
        scheduler.endGame(event.id, result.game.id);
        gamesScheduled++;
      }
    }
    
    expect(gamesScheduled).toBeGreaterThan(0);
    
    for (const playerId of playerIds) {
      const reg = event.getRegistration(playerId);
      expect(reg?.gamesPlayedCount).toBeGreaterThanOrEqual(3);
      expect(reg?.gamesPlayedCount).toBeLessThanOrEqual(6);
      if (reg && reg.gamesPlayedCount >= 6) {
        expect(reg.status).toBe('AWAY');
      }
    }
    
    expect(event.gameHistory.length).toBe(gamesScheduled);
  });

  it('should allow one more game for fulfilled players who return to waiting, then set them away again', async () => {
    const event = await db.createEvent('Test Event', 6, 2, DEFAULT_OWNER);

    const players = [];
    for (let i = 1; i <= 4; i++) {
      const player = await db.createPlayer(`Player ${i}`, DEFAULT_OWNER);
      event.addPlayer(player);
      players.push(player);
    }

    for (const p of players) {
      const reg = event.getRegistration(p.id)!;
      reg.gamesPlayedCount = 6;
      reg.targetGames = 6;
      reg.status = 'WAITING';
      reg.priority = 5;
    }

    const result = scheduler.assignNextGame(event.id, 1);
    expect(result.success).toBe(true);
    expect(result.game).toBeDefined();

    // Target stays at 6 — fulfilled state unchanged
    for (const p of players) {
      expect(event.getRegistration(p.id)!.targetGames).toBe(6);
    }

    result.game!.scores = [11, 7];
    scheduler.startGame(event.id, result.game!.id);
    scheduler.endGame(event.id, result.game!.id);

    for (const pid of [...result.game!.players.team1, ...result.game!.players.team2]) {
      const reg = event.getRegistration(pid)!;
      expect(reg.gamesPlayedCount).toBe(7);
      expect(reg.targetGames).toBe(6);
      expect(reg.status).toBe('AWAY');
    }
  });

  it('should continue scheduling after player becomes unavailable', async () => {
    const event = await db.createEvent('Test Event', 18, 3, DEFAULT_OWNER);
    
    const playerIds: string[] = [];
    for (let i = 1; i <= 12; i++) {
      const player = await db.createPlayer(`Player ${i}`, DEFAULT_OWNER);
      event.addPlayer(player);
      playerIds.push(player.id);
    }
    
    let gamesScheduled = 0;
    for (let i = 0; i < 3; i++) {
      for (let g = 0; g < 2; g++) {
        const result = scheduler.assignNextGame(event.id, 1);
        if (result.success && result.game) {
          result.game.scores = [11, 7];
          scheduler.startGame(event.id, result.game.id);
          scheduler.endGame(event.id, result.game.id);
          gamesScheduled++;
        }
      }
    }
    
    const player1Reg = event.getRegistration(playerIds[0]);
    if (player1Reg) {
      event.updateRegistration(playerIds[0], { status: 'UNAVAILABLE' });
    }
    
    const player2Reg = event.getRegistration(playerIds[1]);
    if (player2Reg) {
      event.updateRegistration(playerIds[1], { status: 'UNAVAILABLE' });
    }
    
    for (let i = 0; i < 3; i++) {
      const result = scheduler.assignNextGame(event.id, 1);
      if (result.success && result.game) {
        result.game.scores = [11, 7];
        scheduler.startGame(event.id, result.game.id);
        scheduler.endGame(event.id, result.game.id);
        gamesScheduled++;
      }
    }
    
    expect(event.gameHistory.length).toBe(gamesScheduled);
  });
});

describe('Score validation', () => {
  it('should accept 11-10 as a golden-point win', () => {
    expect(isValidGameScore(11, 10)).toBe(true);
    expect(isValidGameScore(10, 11)).toBe(true);
  });

  it('should reject scores below 11 and one-point margins other than 11-10', () => {
    expect(isValidGameScore(10, 9)).toBe(false);
    expect(isValidGameScore(12, 11)).toBe(false);
    expect(isValidGameScore(15, 14)).toBe(false);
  });

  it('should accept standard win-by-2 scores at 11+', () => {
    expect(isValidGameScore(11, 7)).toBe(true);
    expect(isValidGameScore(12, 10)).toBe(true);
  });
});

describe('Fixed Partner Doubles', () => {
  let db: Database;
  let scheduler: SchedulingService;

  beforeEach(async () => {
    db = Database.getInstance();
    await db.clear();
    scheduler = new SchedulingService();
  });

  async function createFixedEventWithTeams(teamCount: number) {
    const event = await db.createEvent('Fixed Event', 6, 2, DEFAULT_OWNER, 'FIXED_PARTNER_DOUBLES');
    const players = [];
    for (let i = 1; i <= teamCount * 2; i++) {
      players.push(await db.createPlayer(`Player ${i}`, DEFAULT_OWNER));
    }
    for (let i = 0; i < players.length; i += 2) {
      event.addTeam(players[i], players[i + 1]);
    }
    return { event, players };
  }

  it('should block start until at least 2 teams are registered', async () => {
    const event = await db.createEvent('Fixed', 6, 2, DEFAULT_OWNER, 'FIXED_PARTNER_DOUBLES');
    const player = await db.createPlayer('Player 1', DEFAULT_OWNER);
    event.addTeam(player, await db.createPlayer('Player 2', DEFAULT_OWNER));
    expect(event.validateCanStart().ok).toBe(false);

    const p3 = await db.createPlayer('Player 3', DEFAULT_OWNER);
    const p4 = await db.createPlayer('Player 4', DEFAULT_OWNER);
    event.addTeam(p3, p4);
    expect(event.validateCanStart().ok).toBe(true);
  });

  it('should always place registered partners on the same side during auto allot', async () => {
    const { event, players } = await createFixedEventWithTeams(2);
    event.start();

    const result = scheduler.assignNextGame(event.id, 1);
    expect(result.success).toBe(true);
    expect(result.game).toBeDefined();

    const [a, b] = [players[0].id, players[1].id];
    const [c, d] = [players[2].id, players[3].id];
    const team1 = result.game!.players.team1;
    const team2 = result.game!.players.team2;

    const sameSide = (pair: string[], side: string[]) =>
      (side.includes(pair[0]) && side.includes(pair[1]));

    expect(sameSide([a, b], team1) || sameSide([a, b], team2)).toBe(true);
    expect(sameSide([c, d], team1) || sameSide([c, d], team2)).toBe(true);
  });

  it('should sync AWAY status to both partners', async () => {
    const { event, players } = await createFixedEventWithTeams(2);
    event.start();
    event.setTeamStatus(players[0].id, 'AWAY');

    const regA = event.getRegistration(players[0].id)!;
    const regB = event.getRegistration(players[1].id)!;
    expect(regA.status).toBe('AWAY');
    expect(regB.status).toBe('AWAY');
  });

  it('should end a game with an 11-10 golden-point score', async () => {
    const { event, players } = await createFixedEventWithTeams(2);
    event.start();

    const result = scheduler.assignNextGame(event.id, 1);
    expect(result.success).toBe(true);
    result.game!.scores = [11, 10];
    scheduler.startGame(event.id, result.game!.id);
    const ended = scheduler.endGame(event.id, result.game!.id);
    expect(ended.success).toBe(true);
    expect(event.gameHistory.length).toBe(1);
    expect(event.getRegistration(players[0].id)!.gamesPlayedCount).toBe(1);
  });

  it('should keep partner games played counts in sync after a game', async () => {
    const { event, players } = await createFixedEventWithTeams(2);
    event.start();

    const result = scheduler.assignNextGame(event.id, 1);
    expect(result.success).toBe(true);
    result.game!.scores = [11, 5];
    scheduler.startGame(event.id, result.game!.id);
    scheduler.endGame(event.id, result.game!.id);

    for (const player of players) {
      expect(event.getRegistration(player.id)!.gamesPlayedCount).toBe(1);
    }
  });
});

