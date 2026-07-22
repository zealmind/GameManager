import { Player } from './Player';
import type { Game } from './Game';
import type { EventPlayerRegistration } from './EventPlayerRegistration';
export declare class Event {
    id: string;
    name: string;
    players: Map<string, Player>;
    registrations: Map<string, EventPlayerRegistration>;
    games: Game[];
    courts: number;
    totalGamesToPlay: number;
    gameHistory: Game[];
    startedAt?: Date;
    constructor(name: string, totalGamesToPlay: number, numCourts: number);
    isStarted(): boolean;
    start(): void;
    addPlayer(player: Player): void;
    removePlayer(playerId: string): void;
    getPlayer(playerId: string): Player | undefined;
    getRegistration(playerId: string): EventPlayerRegistration | undefined;
    updateRegistration(playerId: string, updates: Partial<Omit<EventPlayerRegistration, 'eventId' | 'playerId'>>): EventPlayerRegistration | undefined;
    private calculateInitialTargetGames;
    recalculateTargetGames(): void;
    getAvailablePlayers(): Player[];
    getAverageGamesPlayed(): number;
    getPlayersSortedByDeficit(): Player[];
    isComplete(): boolean;
}
//# sourceMappingURL=Event.d.ts.map