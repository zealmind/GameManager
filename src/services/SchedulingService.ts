import { Database } from '../storage/Database';
import { Event } from '../models/Event';
import { Game, createGame } from '../models/Game';
import { Player } from '../models/Player';

export interface ScheduleResult {
  success: boolean;
  game?: Game;
  reason?: string;
  blockingConstraints?: string[];
  shouldWait?: boolean;
  /** Soft constraint notice when the best available grouping is imperfect */
  warning?: string;
}

interface ScoredAssignment {
  team1: string[];
  team2: string[];
  /** Rank 1: fewer unique-partner violations is always better */
  partnerRepeats: number;
  /** Rank 2: lower matrix cost is better (co-play spread) */
  matrixCost: number;
  maxCoPlay: number;
  zeroPairs: number;
  /** Rank 3: higher priority / fewer games played */
  prioritySum: number;
  gamesPlayedSum: number;
}

export class SchedulingService {
  private db: Database;

  constructor() {
    this.db = Database.getInstance();
  }

  getPlayerPriority(playerId: string, event: Event): number {
    const reg = event.getRegistration(playerId);
    if (!reg) return 0;
    if (reg.gamesPlayedCount === 0) return 10;
    if (reg.gamesPlayedCount >= reg.targetGames) {
      // Fulfilled players who explicitly returned to WAITING may play one more game;
      // targetGames / fulfilled state stay unchanged, and endGame sends them AWAY again.
      if (reg.status === 'WAITING') return Math.max(reg.priority, 5);
      return 0;
    }
    return reg.priority;
  }

  getAvailablePlayers(event: Event) {
    const allPlayers = Array.from(event.players.values());
    return allPlayers
      .filter(p => {
        const reg = event.getRegistration(p.id);
        if (!reg || reg.status !== 'WAITING') return false;
        const priority = this.getPlayerPriority(p.id, event);
        return priority > 0;
      })
      .sort((a, b) => {
        const priorityA = this.getPlayerPriority(a.id, event);
        const priorityB = this.getPlayerPriority(b.id, event);
        if (priorityB !== priorityA) return priorityB - priorityA;
        const regA = event.getRegistration(a.id)!;
        const regB = event.getRegistration(b.id)!;
        if (regA.gamesPlayedCount !== regB.gamesPlayedCount) return regA.gamesPlayedCount - regB.gamesPlayedCount;
        return Math.random() - 0.5;
      });
  }

  hasPlayedTogether(player1Id: string, player2Id: string, event: Event): boolean {
    const reg1 = event.getRegistration(player1Id);
    return reg1 ? reg1.partners.includes(player2Id) : false;
  }

  /** Undirected pair key for co-play counts */
  private pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  /**
   * Counts how often each pair has shared a court (teammates or opponents),
   * matching the "Who Played with Who" matrix.
   */
  buildCoPlayCounts(event: Event): Map<string, number> {
    const counts = new Map<string, number>();
    for (const game of event.gameHistory) {
      const ids = [...game.players.team1, ...game.players.team2];
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = this.pairKey(ids[i], ids[j]);
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
    }
    return counts;
  }

  private getCoPlay(counts: Map<string, number>, a: string, b: string): number {
    return counts.get(this.pairKey(a, b)) || 0;
  }

  private combinations<T>(arr: T[], k: number): T[][] {
    const result: T[][] = [];
    const n = arr.length;
    if (k === 0) return [[]];
    if (k > n || k < 0) return result;

    const indices = Array.from({ length: k }, (_, i) => i);
    while (true) {
      result.push(indices.map(i => arr[i]));
      let i = k - 1;
      while (i >= 0 && indices[i] === i + n - k) i--;
      if (i < 0) break;
      indices[i]++;
      for (let j = i + 1; j < k; j++) indices[j] = indices[j - 1] + 1;
    }
    return result;
  }

  /**
   * Score a concrete team assignment.
   * Comparison order (lexicographic):
   *   1. unique partners (minimize partner repeats)
   *   2. matrix-aware co-play spread
   *   3. priority / games-played fairness
   * Soft-fail: still return the best option even when partner repeats are unavoidable.
   */
  private scoreAssignment(
    team1: string[],
    team2: string[],
    event: Event,
    coPlay: Map<string, number>
  ): ScoredAssignment {
    const ids = [...team1, ...team2];
    let prioritySum = 0;
    let gamesPlayedSum = 0;
    for (const id of ids) {
      prioritySum += this.getPlayerPriority(id, event);
      gamesPlayedSum += event.getRegistration(id)?.gamesPlayedCount ?? 0;
    }

    let partnerRepeats = 0;
    if (team1.length === 2 && this.hasPlayedTogether(team1[0], team1[1], event)) partnerRepeats++;
    if (team2.length === 2 && this.hasPlayedTogether(team2[0], team2[1], event)) partnerRepeats++;

    const team1Set = new Set(team1);
    let coPlayCost = 0;
    let maxCoPlay = 0;
    let zeroPairs = 0;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const c = this.getCoPlay(coPlay, ids[i], ids[j]);
        maxCoPlay = Math.max(maxCoPlay, c);
        if (c === 0) zeroPairs++;
        const sameTeam =
          (team1Set.has(ids[i]) && team1Set.has(ids[j])) ||
          (!team1Set.has(ids[i]) && !team1Set.has(ids[j]));
        // Teammate co-play hurts more than opponent co-play
        const weight = sameTeam ? 25 : 10;
        coPlayCost += weight * c * c;
      }
    }

    const matrixCost = coPlayCost + maxCoPlay * 30 - zeroPairs * 20;

    return {
      team1,
      team2,
      partnerRepeats,
      matrixCost,
      maxCoPlay,
      zeroPairs,
      prioritySum,
      gamesPlayedSum,
    };
  }

  /** Negative => a is better than b, per the rank order above */
  private compareAssignments(a: ScoredAssignment, b: ScoredAssignment): number {
    if (a.partnerRepeats !== b.partnerRepeats) return a.partnerRepeats - b.partnerRepeats;
    if (a.matrixCost !== b.matrixCost) return a.matrixCost - b.matrixCost;
    if (a.prioritySum !== b.prioritySum) return b.prioritySum - a.prioritySum;
    if (a.gamesPlayedSum !== b.gamesPlayedSum) return a.gamesPlayedSum - b.gamesPlayedSum;
    return 0;
  }

  /** Three unique ways to split four players into two pairs */
  private teamPartitions(ids: [string, string, string, string]): Array<{ team1: string[]; team2: string[] }> {
    const [a, b, c, d] = ids;
    return [
      { team1: [a, b], team2: [c, d] },
      { team1: [a, c], team2: [b, d] },
      { team1: [a, d], team2: [b, c] },
    ];
  }

  private buildWarning(best: ScoredAssignment): string | undefined {
    const parts: string[] = [];
    if (best.partnerRepeats > 0) {
      parts.push('repeat partners (no unused partnerships available)');
    }
    // This game increments every pair in the foursome by 1.
    // Warn when any pair is already at 2+ so the result would be 3+.
    if (best.maxCoPlay >= 2) {
      parts.push(
        `some players will share a court ${best.maxCoPlay + 1}+ times — cancel and wait if more players become available`
      );
    }
    if (parts.length === 0) return undefined;
    return `Best available grouping used — ${parts.join('; ')}`;
  }

  /**
   * Find the best 2v2 among waiting players. Always returns a grouping when
   * at least 4 players are available (soft-allows partner repeats).
   */
  private findBest2v2(
    available: Player[],
    event: Event,
    lockedTeam1: string[] = [],
    lockedTeam2: string[] = []
  ): ScoredAssignment | null {
    if (available.length + lockedTeam1.length + lockedTeam2.length < 4) return null;

    const coPlay = this.buildCoPlayCounts(event);
    const lockedCount = lockedTeam1.length + lockedTeam2.length;
    const need = 4 - lockedCount;
    if (need < 0) return null;
    if (need === 0) {
      return this.scoreAssignment(lockedTeam1, lockedTeam2, event, coPlay);
    }

    // Cap enumeration size; pool is already priority-sorted
    const pool = available.slice(0, Math.min(available.length, 14));
    if (pool.length < need) return null;

    let best: ScoredAssignment | null = null;
    const fillCombos = this.combinations(pool, need);

    for (const fill of fillCombos) {
      const fillIds = fill.map(p => p.id);
      const candidates = this.enumerateCompletions(lockedTeam1, lockedTeam2, fillIds);
      for (const { team1, team2 } of candidates) {
        if (team1.length + team2.length !== 4) continue;
        if (team1.length === 0 || team2.length === 0) continue;
        // Prefer true 2v2 when possible
        if (team1.length !== 2 || team2.length !== 2) continue;
        const scored = this.scoreAssignment(team1, team2, event, coPlay);
        if (!best || this.compareAssignments(scored, best) < 0) best = scored;
      }
    }

    return best;
  }

  /**
   * Place unlocked player IDs into empty team slots / complete both teams as 2v2.
   */
  private enumerateCompletions(
    lockedTeam1: string[],
    lockedTeam2: string[],
    fillIds: string[]
  ): Array<{ team1: string[]; team2: string[] }> {
    const t1Need = Math.max(0, 2 - lockedTeam1.length);
    const t2Need = Math.max(0, 2 - lockedTeam2.length);
    const results: Array<{ team1: string[]; team2: string[] }> = [];

    if (lockedTeam1.length === 0 && lockedTeam2.length === 0 && fillIds.length === 4) {
      return this.teamPartitions(fillIds as [string, string, string, string]);
    }

    // Choose which fill players go to team1 vs team2
    const t1Combos = this.combinations(fillIds, t1Need);
    for (const t1Extra of t1Combos) {
      const t1Set = new Set(t1Extra);
      const t2Extra = fillIds.filter(id => !t1Set.has(id));
      if (t2Extra.length !== t2Need) continue;
      results.push({
        team1: [...lockedTeam1, ...t1Extra],
        team2: [...lockedTeam2, ...t2Extra],
      });
    }

    return results;
  }

  private findBest1v2(available: Player[], event: Event): ScoredAssignment | null {
    if (available.length < 3) return null;
    const coPlay = this.buildCoPlayCounts(event);
    const pool = available.slice(0, Math.min(available.length, 10));
    let best: ScoredAssignment | null = null;

    for (let i = 0; i < pool.length; i++) {
      for (let j = 0; j < pool.length; j++) {
        if (j === i) continue;
        for (let k = j + 1; k < pool.length; k++) {
          if (k === i) continue;
          const solo = pool[i].id;
          const pair = [pool[j].id, pool[k].id];
          const scored = this.scoreAssignment([solo], pair, event, coPlay);
          if (!best || this.compareAssignments(scored, best) < 0) best = scored;
        }
      }
    }
    return best;
  }

  private commitAssignment(
    event: Event,
    eventId: string,
    courtId: number,
    assignment: ScoredAssignment
  ): ScheduleResult {
    const game = createGame(eventId, courtId, assignment.team1, assignment.team2);
    const warning = this.buildWarning(assignment);
    if (warning) game.allotmentWarning = warning;
    for (const pid of [...assignment.team1, ...assignment.team2]) {
      event.updateRegistration(pid, { status: 'PLAYING' });
    }
    event.games.push(game);
    return {
      success: true,
      game,
      warning,
    };
  }

  assignNextGame(eventId: string, courtId: number): ScheduleResult {
    const event = this.db.getEvent(eventId);
    if (!event) {
      return { success: false, reason: 'Event not found', blockingConstraints: ['Event does not exist'] };
    }
    if (event.isComplete()) {
      return { success: false, reason: 'Event has been ended', blockingConstraints: ['No more games can be scheduled'] };
    }
    if (courtId < 1 || courtId > event.courts) {
      return { success: false, reason: 'Invalid court number', blockingConstraints: [`Court ${courtId} does not exist`] };
    }
    const alreadyActive = event.games.find(g => !g.completed && g.courtId === courtId);
    if (alreadyActive) {
      if (alreadyActive.started) {
        return { success: false, reason: `Court ${courtId} game has already started`, blockingConstraints: [`Court ${courtId} is currently in play`] };
      }
      const previousIds = new Set([...alreadyActive.players.team1, ...alreadyActive.players.team2]);
      for (const pid of previousIds) {
        const reg = event.getRegistration(pid);
        if (reg) reg.status = 'WAITING';
      }
      event.games = event.games.filter(g => !(!g.completed && g.courtId === courtId));
    }

    let available = this.getAvailablePlayers(event);
    if (alreadyActive && available.length > 4) {
      const others = available.filter(p => !new Set([...alreadyActive.players.team1, ...alreadyActive.players.team2]).has(p.id));
      if (others.length >= 4) {
        available = others;
      }
    }

    if (available.length < 3) {
      return { success: false, reason: 'No players available to play next game yet or unable to do pairing among waiting players', blockingConstraints: ['Insufficient available players'], shouldWait: true };
    }

    // Prefer best-balanced 2v2 (soft partner constraint) when 4+ waiting
    if (available.length >= 4) {
      const best = this.findBest2v2(available, event);
      if (best) {
        return this.commitAssignment(event, eventId, courtId, best);
      }
    }

    // Fallback: best 1v2 when only 3 players (or 2v2 somehow unavailable)
    const best1v2 = this.findBest1v2(available, event);
    if (best1v2) {
      return this.commitAssignment(event, eventId, courtId, best1v2);
    }

    return { success: false, reason: 'No players available to play next game yet or unable to do pairing among waiting players', blockingConstraints: ['Try releasing some players from AWAY/RETIRED'], shouldWait: true };
  }

  completePartialGame(eventId: string, courtId: number, team1: string[], team2: string[]): ScheduleResult {
    const event = this.db.getEvent(eventId);
    if (!event) {
      return { success: false, reason: 'Event not found', blockingConstraints: ['Event does not exist'] };
    }
    if (event.isComplete()) {
      return { success: false, reason: 'Event has been ended', blockingConstraints: ['No more games can be scheduled'] };
    }
    if (courtId < 1 || courtId > event.courts) {
      return { success: false, reason: 'Invalid court number', blockingConstraints: [`Court ${courtId} does not exist`] };
    }

    const alreadyActive = event.games.find(g => !g.completed && g.courtId === courtId);
    if (alreadyActive) {
      if (alreadyActive.started) {
        return { success: false, reason: `Court ${courtId} game has already started`, blockingConstraints: [`Court ${courtId} is currently in play`] };
      }
      const previousIds = new Set([...alreadyActive.players.team1, ...alreadyActive.players.team2]);
      for (const pid of previousIds) {
        const reg = event.getRegistration(pid);
        if (reg) reg.status = 'WAITING';
      }
      event.games = event.games.filter(g => !(!g.completed && g.courtId === courtId));
    }

    const selectedIds = new Set([...team1, ...team2]);
    if (selectedIds.size !== team1.length + team2.length) {
      return { success: false, reason: 'Duplicate players in selection', blockingConstraints: ['Players must be distinct'] };
    }

    for (const pid of selectedIds) {
      const reg = event.getRegistration(pid);
      if (!reg) {
        return { success: false, reason: `Player ${pid} is not registered for this event`, blockingConstraints: ['Invalid player'] };
      }
      if (reg.status !== 'WAITING') {
        return { success: false, reason: `Player is not available`, blockingConstraints: ['Player not WAITING'] };
      }
    }

    const totalSelected = team1.length + team2.length;
    if (totalSelected >= 4) {
      const coPlay = this.buildCoPlayCounts(event);
      const scored = this.scoreAssignment(team1, team2, event, coPlay);
      return this.commitAssignment(event, eventId, courtId, scored);
    }

    const remainingNeeded = 4 - totalSelected;
    const available = this.getAvailablePlayers(event).filter(p => !selectedIds.has(p.id));

    if (available.length < remainingNeeded) {
      return { success: false, reason: 'Not enough available players to complete the game', blockingConstraints: ['Insufficient available players'], shouldWait: true };
    }

    const best = this.findBest2v2(available, event, team1, team2);
    if (best) {
      return this.commitAssignment(event, eventId, courtId, best);
    }

    return { success: false, reason: 'No players available to play next game yet or unable to do pairing among waiting players', blockingConstraints: ['Try releasing some players from AWAY/RETIRED'], shouldWait: true };
  }

  cancelGame(eventId: string, gameId: string): ScheduleResult {
    const event = this.db.getEvent(eventId);
    if (!event) return { success: false, reason: 'Event not found' };
    const gameIndex = event.games.findIndex(g => g.id === gameId);
    if (gameIndex === -1) return { success: false, reason: 'Game not found' };
    const game = event.games[gameIndex];
    if (game.completed) return { success: false, reason: 'Game already completed' };

    const allPlayerIds = [...game.players.team1, ...game.players.team2];
    for (const pid of allPlayerIds) {
      const reg = event.getRegistration(pid);
      if (reg) {
        reg.status = 'WAITING';
      }
    }

    event.games.splice(gameIndex, 1);
    return { success: true, game };
  }

  startGame(eventId: string, gameId: string): ScheduleResult {
    const event = this.db.getEvent(eventId);
    if (!event) return { success: false, reason: 'Event not found' };
    const game = event.games.find(g => g.id === gameId);
    if (!game) return { success: false, reason: 'Game not found' };
    if (game.completed) return { success: false, reason: 'Game already completed' };
    if (game.started) return { success: false, reason: 'Game has already started' };
    if (game.players.team1.length !== 2 || game.players.team2.length !== 2) {
      for (const pid of [...game.players.team1, ...game.players.team2]) {
        const reg = event.getRegistration(pid);
        if (reg) reg.status = 'WAITING';
      }
      event.games = event.games.filter(g => g.id !== gameId);
      return { success: false, reason: 'Both teams must have exactly 2 players to start the game', blockingConstraints: ['Team size must be 2v2'] };
    }
    game.gameNumber = event.nextGameNumber++;
    game.started = true;
    game.startedAt = new Date();
    return { success: true, game };
  }

  endGame(eventId: string, gameId: string, scores?: { score_team1?: number; score_team2?: number }): ScheduleResult {
    const event = this.db.getEvent(eventId);
    if (!event) return { success: false, reason: 'Event not found' };
    const game = event.games.find(g => g.id === gameId);
    if (!game) return { success: false, reason: 'Game not found' };
    if (game.completed) return { success: false, reason: 'Game already completed' };
    if (!game.started) return { success: false, reason: 'Game has not started yet' };

    if (scores?.score_team1 !== undefined && scores?.score_team2 !== undefined) {
      game.scores = [scores.score_team1, scores.score_team2];
    }
    if (game.scores === undefined) {
      return { success: false, reason: 'Scores have not been provided yet', blockingConstraints: ['Score is required'] };
    }

    const [team1, team2] = game.scores;
    if ((team1 < 11 && team2 < 11) || Math.abs(team1 - team2) < 2) {
      return { success: false, reason: 'Invalid score: one team must reach at least 11 and win by 2', blockingConstraints: ['Score validation failed'] };
    }

    game.completed = true;
    game.completedAt = new Date();

    event.gameHistory.push({ ...game, players: { ...game.players, team1: [...game.players.team1], team2: [...game.players.team2] } });

    const allPlayerIds = [...game.players.team1, ...game.players.team2];
    const team1Ids = new Set(game.players.team1);
    for (const playerId of allPlayerIds) {
      const reg = event.getRegistration(playerId);
      if (reg) {
        reg.gamesPlayedCount++;
        if (reg.gamesPlayedCount >= reg.targetGames) {
          reg.status = 'AWAY';
        } else {
          reg.status = 'WAITING';
        }
        const teammate = allPlayerIds.find(pid => pid !== playerId && team1Ids.has(pid) === team1Ids.has(playerId));
        if (teammate && !reg.partners.includes(teammate)) {
          reg.partners.push(teammate);
        }
      }
    }

    // Priority recency check (Step 6)
    const justFinishedIds = allPlayerIds;
    const wasBackToBack = new Set<string>();
    for (const pid of justFinishedIds) {
      const reg = event.getRegistration(pid);
      if (reg && this.getPlayerPriority(pid, event) === 7) {
        wasBackToBack.add(pid);
      }
    }
    for (const pid of justFinishedIds) {
      const reg = event.getRegistration(pid);
      if (reg && reg.status === 'WAITING') {
        reg.priority = 5;
      }
    }
    const newPlayerCount = event.getAvailablePlayers().filter(p => this.getPlayerPriority(p.id, event) === 10).length;
    if (newPlayerCount === 0 || newPlayerCount < 3) {
      const promoteCount = Math.random() < 0.5 ? 1 : 2;
      let promoted = 0;
      const promotedIds = new Set<string>();
      for (const pid of justFinishedIds) {
        if (!wasBackToBack.has(pid)) {
          const reg = event.getRegistration(pid);
          if (reg && reg.status === 'WAITING') {
            reg.priority = 7;
            promoted++;
            promotedIds.add(pid);
            if (promoted >= promoteCount) break;
          }
        }
      }
      if (promoted < promoteCount) {
        for (const pid of justFinishedIds) {
          if (promotedIds.has(pid)) continue;
          const reg = event.getRegistration(pid);
          if (reg && reg.status === 'WAITING') {
            reg.priority = 7;
            promoted++;
            if (promoted >= promoteCount) break;
          }
        }
      }
    }

    return { success: true, game };
  }
}
