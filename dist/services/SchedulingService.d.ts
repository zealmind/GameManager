import { Event } from '../models/Event';
import { Game } from '../models/Game';
export interface ScheduleResult {
    success: boolean;
    game?: Game;
    reason?: string;
    blockingConstraints?: string[];
    shouldWait?: boolean;
}
export declare class SchedulingService {
    private db;
    constructor();
    getAvailablePlayers(event: Event): import("../models").Player[];
    hasPlayedTogether(player1Id: string, player2Id: string, event: Event): boolean;
    assignNextGame(eventId: string, courtId: number): ScheduleResult;
    startGame(eventId: string, gameId: string): ScheduleResult;
    endGame(eventId: string, gameId: string, scores?: {
        score_team1?: number;
        score_team2?: number;
    }): ScheduleResult;
}
//# sourceMappingURL=SchedulingService.d.ts.map