import { randomUUID } from 'node:crypto';
import { Player } from './Player';
import type { Game } from './Game';
import type { EventPlayerRegistration, PlayerStatus } from './EventPlayerRegistration';

export type EventFormat = 'ROTATING_DOUBLES' | 'FIXED_PARTNER_DOUBLES';

export interface EventTeam {
  id: string;
  playerIds: [string, string];
  gamesPlayed: number;
  targetGames: number;
  status: PlayerStatus;
  priority: number;
}

export function teamKey(playerIdA: string, playerIdB: string): string {
  return playerIdA < playerIdB ? `${playerIdA}|${playerIdB}` : `${playerIdB}|${playerIdA}`;
}

export class Event {
  id: string;
  name: string;
  format: EventFormat;
  players: Map<string, Player>; // playerId -> Player (registered in this event)
  registrations: Map<string, EventPlayerRegistration>; // playerId -> EventPlayerRegistration
  games: Game[];
  courts: number;
  totalGamesToPlay: number;
  gameHistory: Game[]; // completed games
  nextGameNumber: number;
  startedAt?: Date;
  endedAt?: Date;
  sharedAccess: Array<{ token: string; permission: 'viewer' | 'moderator'; invitedBy: string; createdAt: string }>;

  constructor(name: string, totalGamesToPlay: number, numCourts: number, format: EventFormat = 'ROTATING_DOUBLES') {
    this.id = randomUUID();
    this.name = name;
    this.format = format;
    this.players = new Map<string, Player>();
    this.registrations = new Map<string, EventPlayerRegistration>();
    this.games = []; // currently active games (max courts)
    this.courts = numCourts;
    this.totalGamesToPlay = totalGamesToPlay;
    this.gameHistory = []; // completed games
    this.nextGameNumber = 1;
    this.sharedAccess = [];
  }

  isFixedPartnerDoubles(): boolean {
    return this.format === 'FIXED_PARTNER_DOUBLES';
  }

  isStarted(): boolean {
    return !!this.startedAt;
  }

  isEnded(): boolean {
    return !!this.endedAt;
  }

  start(): void {
    if (this.isStarted()) return;
    this.startedAt = new Date();
    for (const reg of this.registrations.values()) {
      if (reg.status !== 'RETIRED') {
        reg.status = 'WAITING';
      }
    }
    this.assignNickNames();
  }

  validateCanStart(): { ok: boolean; error?: string } {
    if (this.isFixedPartnerDoubles()) {
      const teams = this.getTeams();
      if (teams.length < 2) {
        return { ok: false, error: 'Need at least 2 teams to start' };
      }
      if (this.registrations.size % 2 !== 0) {
        return { ok: false, error: 'Every player must have a partner' };
      }
      for (const reg of this.registrations.values()) {
        if (!reg.fixedPartnerId || !this.registrations.has(reg.fixedPartnerId)) {
          return { ok: false, error: 'Every player must have a partner' };
        }
        if (reg.fixedPartnerId === reg.playerId) {
          return { ok: false, error: 'Every player must have a partner' };
        }
      }
      return { ok: true };
    }
    if (this.registrations.size < 4) {
      return { ok: false, error: 'Need at least 4 players to start' };
    }
    return { ok: true };
  }

  /** Assign unique per-event nicknames on registrations. Returns true if any changed. */
  assignNickNames(): boolean {
    const regs = Array.from(this.registrations.values());
    const nickCounts = new Map<string, number>();
    for (const reg of regs) {
      if (!reg.nickName) continue;
      nickCounts.set(reg.nickName, (nickCounts.get(reg.nickName) || 0) + 1);
    }
    let changed = false;
    // Collisions (e.g. migrated global nicknames) — clear and reassign all
    if ([...nickCounts.values()].some(c => c > 1)) {
      for (const reg of regs) delete reg.nickName;
      changed = true;
    }

    const usedLetters = new Set(
      regs.map(r => r.nickName).filter((n): n is string => !!n)
    );
    const unassigned = regs.filter(r => !r.nickName);
    if (unassigned.length === 0) return changed;

    let nextCode = 65;
    const nextLetter = (): string => {
      while (usedLetters.has(String.fromCharCode(nextCode))) nextCode++;
      const letter = String.fromCharCode(nextCode);
      usedLetters.add(letter);
      nextCode++;
      return letter;
    };

    const shuffled = [...unassigned];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    shuffled.forEach(r => { r.nickName = nextLetter(); });
    return true;
  }

  getTeamMate(playerId: string): string | undefined {
    const reg = this.registrations.get(playerId);
    return reg?.fixedPartnerId;
  }

  getTeams(): EventTeam[] {
    if (!this.isFixedPartnerDoubles()) return [];

    const seen = new Set<string>();
    const teams: EventTeam[] = [];

    for (const reg of this.registrations.values()) {
      if (!reg.fixedPartnerId) continue;
      const key = teamKey(reg.playerId, reg.fixedPartnerId);
      if (seen.has(key)) continue;
      seen.add(key);

      const mateReg = this.registrations.get(reg.fixedPartnerId);
      const gamesPlayed = reg.gamesPlayedCount;
      const targetGames = reg.targetGames;
      const status = reg.status;
      const priority = reg.priority;

      teams.push({
        id: key,
        playerIds: reg.playerId < reg.fixedPartnerId
          ? [reg.playerId, reg.fixedPartnerId]
          : [reg.fixedPartnerId, reg.playerId],
        gamesPlayed,
        targetGames,
        status: mateReg && mateReg.status !== status ? this.mergeTeamStatus(reg.status, mateReg.status) : status,
        priority: Math.max(priority, mateReg?.priority ?? priority),
      });
    }

    return teams;
  }

  private mergeTeamStatus(a: PlayerStatus, b: PlayerStatus): PlayerStatus {
    const order: PlayerStatus[] = ['PLAYING', 'WAITING', 'FULLFILLED', 'AWAY', 'UNAVAILABLE', 'RETIRED'];
    const rank = (s: PlayerStatus) => order.indexOf(s);
    return rank(a) <= rank(b) ? a : b;
  }

  isRegisteredPair(playerIds: string[]): boolean {
    if (playerIds.length !== 2) return false;
    const [a, b] = playerIds;
    const regA = this.registrations.get(a);
    const regB = this.registrations.get(b);
    return !!regA && !!regB && regA.fixedPartnerId === b && regB.fixedPartnerId === a;
  }

  addTeam(playerA: Player, playerB: Player): void {
    if (playerA.id === playerB.id) {
      throw new Error('A team cannot include the same player twice');
    }
    this.addPlayer(playerA);
    this.addPlayer(playerB);

    const regA = this.registrations.get(playerA.id)!;
    const regB = this.registrations.get(playerB.id)!;
    regA.fixedPartnerId = playerB.id;
    regB.fixedPartnerId = playerA.id;
  }

  // Player registration
  addPlayer(player: Player): void {
    if (!this.players.has(player.id)) {
      this.players.set(player.id, player);
      const registration: EventPlayerRegistration = {
        eventId: this.id,
        playerId: player.id,
        gamesPlayedCount: 0,
        status: this.isStarted() ? 'WAITING' : 'WAITING',
        targetGames: this.calculateInitialTargetGames(),
        partners: [],
        priority: 10,
      };
      this.registrations.set(player.id, registration);
    }
  }

  removeTeam(playerId: string): void {
    const mateId = this.getTeamMate(playerId);
    if (this.isStarted()) {
      const reg = this.registrations.get(playerId);
      const mateReg = mateId ? this.registrations.get(mateId) : undefined;
      if ((reg && reg.status === 'PLAYING') || (mateReg && mateReg.status === 'PLAYING')) {
        throw new Error('Cannot remove a team that is currently playing');
      }
      if (reg) reg.status = 'RETIRED';
      if (mateReg) mateReg.status = 'RETIRED';
      return;
    }

    this.players.delete(playerId);
    this.registrations.delete(playerId);
    if (mateId) {
      this.players.delete(mateId);
      this.registrations.delete(mateId);
    }
  }

  removePlayer(playerId: string): void {
    if (this.isFixedPartnerDoubles()) {
      this.removeTeam(playerId);
      return;
    }

    if (this.isStarted()) {
      const reg = this.registrations.get(playerId);
      if (reg && reg.status === 'PLAYING') {
        throw new Error('Cannot remove a player who is currently playing');
      }
      this.registrations.get(playerId) && (this.registrations.get(playerId)!.status = 'RETIRED');
      return;
    }
    this.players.delete(playerId);
    this.registrations.delete(playerId);
  }

  setTeamStatus(playerId: string, status: PlayerStatus, extra?: Partial<EventPlayerRegistration>): void {
    const mateId = this.getTeamMate(playerId);
    const ids = mateId ? [playerId, mateId] : [playerId];
    for (const id of ids) {
      this.updateRegistration(id, { status, ...extra });
    }
  }

  syncTeamRegistration(playerId: string, fields: Partial<Omit<EventPlayerRegistration, 'eventId' | 'playerId'>>): void {
    const mateId = this.getTeamMate(playerId);
    this.updateRegistration(playerId, fields);
    if (mateId) {
      this.updateRegistration(mateId, fields);
    }
  }

  getPlayer(playerId: string): Player | undefined {
    return this.players.get(playerId);
  }

  getRegistration(playerId: string): EventPlayerRegistration | undefined {
    return this.registrations.get(playerId);
  }

  updateRegistration(playerId: string, updates: Partial<Omit<EventPlayerRegistration, 'eventId' | 'playerId'>>): EventPlayerRegistration | undefined {
    const registration = this.registrations.get(playerId);
    if (!registration) return undefined;

    const updated = { ...registration, ...updates };
    this.registrations.set(playerId, updated);
    return updated;
  }

  private calculateInitialTargetGames(): number {
    return this.totalGamesToPlay;
  }

  recalculateTargetGames(): void {
    const availablePlayers = Array.from(this.registrations.values()).filter(r => !['UNAVAILABLE', 'AWAY', 'RETIRED'].includes(r.status));

    availablePlayers.forEach(reg => {
      this.updateRegistration(reg.playerId, { targetGames: this.totalGamesToPlay });
    });
  }

  getAvailablePlayers(): Player[] {
    if (this.isFixedPartnerDoubles()) {
      const teams = this.getTeams().filter(t => t.status === 'WAITING');
      const players: Player[] = [];
      for (const team of teams) {
        for (const pid of team.playerIds) {
          const player = this.players.get(pid);
          if (player) players.push(player);
        }
      }
      return players;
    }

    return Array.from(this.players.values())
      .filter(player => {
        const reg = this.registrations.get(player.id);
        return reg && reg.status === 'WAITING';
      });
  }

  getAverageGamesPlayed(): number {
    if (this.isFixedPartnerDoubles()) {
      const teams = this.getTeams();
      if (teams.length === 0) return 0;
      const total = teams.reduce((sum, team) => sum + team.gamesPlayed, 0);
      return total / teams.length;
    }

    const registrations = Array.from(this.registrations.values());
    if (registrations.length === 0) return 0;
    const total = registrations.reduce((sum, reg) => sum + reg.gamesPlayedCount, 0);
    return total / registrations.length;
  }

  getPlayersSortedByDeficit(): Player[] {
    const avg = this.getAverageGamesPlayed();
    const availableRegs = Array.from(this.registrations.values())
      .filter(reg => !['UNAVAILABLE', 'AWAY', 'RETIRED'].includes(reg.status));

    return availableRegs
      .map(reg => this.players.get(reg.playerId)!)
      .sort((a, b) => {
        const regA = this.registrations.get(a.id)!;
        const regB = this.registrations.get(b.id)!;
        const deficitA = avg - regA.gamesPlayedCount;
        const deficitB = avg - regB.gamesPlayedCount;
        return deficitB - deficitA;
      });
  }

  isComplete(): boolean {
    return this.isEnded();
  }
}
