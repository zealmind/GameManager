export interface Game {
    id: string;
    eventId: string;
    gameNumber: number;
    courtId: number;
    players: {
        team1: string[];
        team2: string[];
    };
    scores?: [number, number];
    createdAt: Date;
    completed: boolean;
    started: boolean;
    startedAt?: Date;
    completedAt?: Date;
    /** Soft-constraint notice from auto/manual allotment (shown until start/cancel) */
    allotmentWarning?: string;
}
export declare function createGame(eventId: string, courtId: number, team1: string[], team2: string[]): Game;
//# sourceMappingURL=Game.d.ts.map