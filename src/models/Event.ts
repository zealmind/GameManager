import { randomUUID } from 'node:crypto';
import { Player } from './Player';
import type { Game } from './Game';
import type { EventPlayerRegistration } from './EventPlayerRegistration';

export class Event {
  id: string;
  name: string;
  players: Map<string, Player>; // playerId -> Player (registered in this event)
  registrations: Map<string, EventPlayerRegistration>; // playerId -> EventPlayerRegistration
  games: Game[];
  courts: number;
  totalGamesToPlay: number;
  gameHistory: Game[]; // completed games
  nextGameNumber: number;
  startedAt?: Date;
  endedAt?: Date;

  constructor(name: string, totalGamesToPlay: number, numCourts: number) {
    this.id = randomUUID();
    this.name = name;
    this.players = new Map<string, Player>();
    this.registrations = new Map<string, EventPlayerRegistration>();
    this.games = []; // currently active games (max courts)
    this.courts = numCourts;
    this.totalGamesToPlay = totalGamesToPlay;
    this.gameHistory = []; // completed games
    this.nextGameNumber = 1;
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
  }

  // Player registration
  addPlayer(player: Player): void {
    if (!this.players.has(player.id)) {
      this.players.set(player.id, player);
      // Initialize registration for this player in this event
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

  removePlayer(playerId: string): void {
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

  // Calculate initial target games for a new player
  // Each player should get at least totalGamesToPlay games
  private calculateInitialTargetGames(): number {
    return this.totalGamesToPlay;
  }

  // Recalculate target games for all players based on current registration count
  // Each available player should get at least totalGamesToPlay games
  recalculateTargetGames(): void {
    const availablePlayers = Array.from(this.registrations.values()).filter(r => !['UNAVAILABLE', 'AWAY', 'RETIRED'].includes(r.status));
    
    availablePlayers.forEach(reg => {
      this.updateRegistration(reg.playerId, { targetGames: this.totalGamesToPlay });
    });
  }

  // Helper methods for scheduling logic
  getAvailablePlayers(): Player[] {
    return Array.from(this.players.values())
      .filter(player => {
        const reg = this.registrations.get(player.id);
        return reg && reg.status === 'WAITING';
      });
  }

  getAverageGamesPlayed(): number {
    const registrations = Array.from(this.registrations.values());
    if (registrations.length === 0) return 0;
    const total = registrations.reduce((sum, reg) => sum + reg.gamesPlayedCount, 0);
    return total / registrations.length;
  }

  // Get players sorted by how far below average they are (most negative first)
  // Excludes UNAVAILABLE, AWAY, and RETIRED players
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
        return deficitB - deficitA; // most negative deficit first
      });
  }

  isComplete(): boolean {
    return this.isEnded();
  }
}