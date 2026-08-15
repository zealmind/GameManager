import { Event } from '../models/Event';
import { Game } from '../models/Game';
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
export declare class SchedulingService {
    private db;
    constructor();
    getPlayerPriority(playerId: string, event: Event): number;
    getAvailablePlayers(event: Event): Player[];
    hasPlayedTogether(player1Id: string, player2Id: string, event: Event): boolean;
    /** Undirected pair key for co-play counts */
    private pairKey;
    /**
     * Counts how often each pair has shared a court (teammates or opponents),
     * matching the "Who Played with Who" matrix.
     */
    buildCoPlayCounts(event: Event): Map<string, number>;
    private getCoPlay;
    private combinations;
    /**
     * Score a concrete team assignment.
     * Comparison order (lexicographic):
     *   1. unique partners (minimize partner repeats)
     *   2. matrix-aware co-play spread
     *   3. priority / games-played fairness
     * Soft-fail: still return the best option even when partner repeats are unavoidable.
     */
    private scoreAssignment;
    /** Negative => a is better than b, per the rank order above */
    private compareAssignments;
    /** Three unique ways to split four players into two pairs */
    private teamPartitions;
    private buildWarning;
    /**
     * Find the best 2v2 among waiting players. Always returns a grouping when
     * at least 4 players are available (soft-allows partner repeats).
     */
    private findBest2v2;
    /**
     * Place unlocked player IDs into empty team slots / complete both teams as 2v2.
     */
    private enumerateCompletions;
    private findBest1v2;
    private commitAssignment;
    assignNextGame(eventId: string, courtId: number): ScheduleResult;
    completePartialGame(eventId: string, courtId: number, team1: string[], team2: string[]): ScheduleResult;
    cancelGame(eventId: string, gameId: string): ScheduleResult;
    startGame(eventId: string, gameId: string): ScheduleResult;
    endGame(eventId: string, gameId: string, scores?: {
        score_team1?: number;
        score_team2?: number;
    }): ScheduleResult;
}
//# sourceMappingURL=SchedulingService.d.ts.map