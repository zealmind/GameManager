import { Player } from './Player';
import type { Game } from './Game';
import type { EventPlayerRegistration, PlayerStatus } from './EventPlayerRegistration';
export type EventFormat = 'ROTATING_DOUBLES' | 'FIXED_PARTNER_DOUBLES' | 'SINGLES_ROUND_ROBIN';
export interface EventTeam {
    id: string;
    playerIds: [string, string];
    gamesPlayed: number;
    targetGames: number;
    status: PlayerStatus;
    priority: number;
}
export declare function teamKey(playerIdA: string, playerIdB: string): string;
export declare class Event {
    id: string;
    name: string;
    format: EventFormat;
    players: Map<string, Player>;
    registrations: Map<string, EventPlayerRegistration>;
    games: Game[];
    courts: number;
    totalGamesToPlay: number;
    gameHistory: Game[];
    nextGameNumber: number;
    startedAt?: Date;
    endedAt?: Date;
    sharedAccess: Array<{
        token: string;
        permission: 'viewer' | 'moderator';
        invitedBy: string;
        createdAt: string;
    }>;
    constructor(name: string, totalGamesToPlay: number, numCourts: number, format?: EventFormat);
    isFixedPartnerDoubles(): boolean;
    isSinglesRoundRobin(): boolean;
    isStarted(): boolean;
    isEnded(): boolean;
    start(): void;
    validateCanStart(): {
        ok: boolean;
        error?: string;
    };
    /** Assign unique per-event nicknames on registrations. Returns true if any changed. */
    assignNickNames(): boolean;
    getTeamMate(playerId: string): string | undefined;
    getTeams(): EventTeam[];
    private mergeTeamStatus;
    isRegisteredPair(playerIds: string[]): boolean;
    addTeam(playerA: Player, playerB: Player): void;
    addPlayer(player: Player): void;
    removeTeam(playerId: string): void;
    removePlayer(playerId: string): void;
    setTeamStatus(playerId: string, status: PlayerStatus, extra?: Partial<EventPlayerRegistration>): void;
    syncTeamRegistration(playerId: string, fields: Partial<Omit<EventPlayerRegistration, 'eventId' | 'playerId'>>): void;
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