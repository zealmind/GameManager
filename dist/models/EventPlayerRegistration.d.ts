export type PlayerStatus = 'WAITING' | 'PLAYING' | 'UNAVAILABLE' | 'AWAY' | 'RETIRED';
export interface EventPlayerRegistration {
    eventId: string;
    playerId: string;
    gamesPlayedCount: number;
    status: PlayerStatus;
    targetGames: number;
    partners: string[];
}
//# sourceMappingURL=EventPlayerRegistration.d.ts.map