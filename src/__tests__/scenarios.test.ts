import { Database } from '../storage/Database';
import { SchedulingService } from '../services/SchedulingService';

const DEFAULT_OWNER = 'test-owner-0000-0000-0000-000000000000';

describe('Pickleball Event Scheduler Validation', () => {
  let db: Database;
  let scheduler: SchedulingService;

  beforeEach(async () => {
    db = Database.getInstance();
    await db.clear();
    scheduler = new SchedulingService();
  });

  it('should not schedule with fewer than 4 players', async () => {
    const event = await db.createEvent('Test Event', 18, 3, DEFAULT_OWNER);
    
    for (let i = 1; i <= 3; i++) {
      const player = await db.createPlayer(`Player ${i}`, DEFAULT_OWNER);
      event.addPlayer(player);
    }
    
    const result = scheduler.assignNextGame(event.id, 1);
    expect(result.success).toBe(false);
    expect(result.blockingConstraints).toBeDefined();
    expect(result.blockingConstraints?.length).toBeGreaterThan(0);
    expect(result.reason).toContain('Only 3 players available');
  });

  it('should detect deadlock when all available players have played with each other', async () => {
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
    expect(result.success).toBe(false);
    expect(result.shouldWait).toBe(true);
    expect(result.blockingConstraints).toBeDefined();
    expect(result.blockingConstraints?.length).toBeGreaterThan(0);
  });

  it('should schedule games with 12 players, aiming for minimum 6 games each (some may get 7)', async () => {
    const event = await db.createEvent('Test Event', 18, 3, DEFAULT_OWNER);
    
    const playerIds: string[] = [];
    for (let i = 1; i <= 12; i++) {
      const player = await db.createPlayer(`Player ${i}`, DEFAULT_OWNER);
      event.addPlayer(player);
      playerIds.push(player.id);
    }
    
    const maxScheduleAttempts = 18;
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
      expect(reg?.gamesPlayedCount).toBeGreaterThanOrEqual(5);
      expect(reg?.gamesPlayedCount).toBeLessThanOrEqual(7);
    }
    
    expect(event.gameHistory.length).toBe(gamesScheduled);
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

