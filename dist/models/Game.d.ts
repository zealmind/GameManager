export interface Game {
    id: string;
    eventId: string;
    courtId: number;
    players: {
        team1: [string, string];
        team2: [string, string];
    };
    scores?: [number, number];
    createdAt: Date;
    completed: boolean;
    started: boolean;
    startedAt?: Date;
    completedAt?: Date;
}
export declare function createGame(eventId: string, courtId: number, players: [string, string, string, string]): Game;
//# sourceMappingURL=Game.d.ts.map