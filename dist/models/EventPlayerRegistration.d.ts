export type PlayerStatus = 'WAITING' | 'PLAYING' | 'UNAVAILABLE' | 'AWAY' | 'RETIRED' | 'FULLFILLED';
export interface EventPlayerRegistration {
    eventId: string;
    playerId: string;
    gamesPlayedCount: number;
    status: PlayerStatus;
    targetGames: number;
    partners: string[];
    priority: number;
    /** Singles: games played back-to-back without sitting out an allotment round. */
    consecutiveGamesPlayed?: number;
    /** Per-event display letter; independent of the shared Player. */
    nickName?: string;
    /** Fixed partner doubles: permanent teammate for this event. */
    fixedPartnerId?: string;
}
//# sourceMappingURL=EventPlayerRegistration.d.ts.map