"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulingService = void 0;
const Database_1 = require("../storage/Database");
const Game_1 = require("../models/Game");
class SchedulingService {
    db;
    constructor() {
        this.db = Database_1.Database.getInstance();
    }
    getAvailablePlayers(event) {
        const allPlayers = Array.from(event.players.values());
        return allPlayers.filter(p => {
            const reg = event.getRegistration(p.id);
            return reg && reg.status === 'WAITING';
        }).sort((a, b) => {
            const regA = event.getRegistration(a.id);
            const regB = event.getRegistration(b.id);
            const avg = event.getAverageGamesPlayed();
            const deficitA = avg - regA.gamesPlayedCount;
            const deficitB = avg - regB.gamesPlayedCount;
            return deficitB - deficitA;
        });
    }
    hasPlayedTogether(player1Id, player2Id, event) {
        const reg1 = event.getRegistration(player1Id);
        return reg1 ? reg1.partners.includes(player2Id) : false;
    }
    assignNextGame(eventId, courtId) {
        const event = this.db.getEvent(eventId);
        if (!event) {
            return { success: false, reason: 'Event not found', blockingConstraints: ['Event does not exist'] };
        }
        if (event.isComplete()) {
            return { success: false, reason: 'Event is already complete', blockingConstraints: ['All scheduled games have been played'] };
        }
        if (courtId < 1 || courtId > event.courts) {
            return { success: false, reason: 'Invalid court number', blockingConstraints: [`Court ${courtId} does not exist`] };
        }
        const alreadyActive = event.games.find(g => !g.completed && g.courtId === courtId);
        if (alreadyActive) {
            if (alreadyActive.started) {
                return { success: false, reason: `Court ${courtId} game has already started`, blockingConstraints: [`Court ${courtId} is currently in play`] };
            }
            const previousIds = new Set([...alreadyActive.players.team1, ...alreadyActive.players.team2]);
            for (const pid of previousIds) {
                const reg = event.getRegistration(pid);
                if (reg)
                    reg.status = 'WAITING';
            }
            event.games = event.games.filter(g => !(!g.completed && g.courtId === courtId));
        }
        let available = this.getAvailablePlayers(event);
        if (alreadyActive && available.length > 4) {
            const others = available.filter(p => !new Set([...alreadyActive.players.team1, ...alreadyActive.players.team2]).has(p.id));
            if (others.length >= 4) {
                available = others;
            }
        }
        if (available.length < 4) {
            return { success: false, reason: `Only ${available.length} players available (need at least 4)`, blockingConstraints: ['Insufficient available players'], shouldWait: true };
        }
        const maxAttempts = Math.min(available.length, 30);
        for (let i = 0; i < maxAttempts; i++) {
            const topPlayer = available[i];
            const remaining = available.filter(p => p.id !== topPlayer.id);
            const partner = remaining.find(p => !this.hasPlayedTogether(topPlayer.id, p.id, event));
            if (!partner)
                continue;
            const team1 = [topPlayer, partner];
            const team1Ids = new Set([topPlayer.id, partner.id]);
            const opponentsCandidates = remaining.filter(p => !team1Ids.has(p.id));
            let team2 = [];
            outer: for (let j = 0; j < opponentsCandidates.length - 1; j++) {
                for (let k = j + 1; k < opponentsCandidates.length; k++) {
                    if (!this.hasPlayedTogether(opponentsCandidates[j].id, opponentsCandidates[k].id, event)) {
                        team2 = [opponentsCandidates[j], opponentsCandidates[k]];
                        break outer;
                    }
                }
            }
            if (team2.length < 2)
                continue;
            const playerIds = [team1[0].id, team1[1].id, team2[0].id, team2[1].id];
            const game = (0, Game_1.createGame)(eventId, courtId, playerIds);
            const allPlayers = [...team1, ...team2];
            for (const p of allPlayers) {
                event.updateRegistration(p.id, { status: 'PLAYING' });
            }
            event.games.push(game);
            return { success: true, game };
        }
        return { success: false, reason: 'No valid partner/opponent combination found', blockingConstraints: ['Try releasing some players from AWAY/RETIRED'], shouldWait: true };
    }
    startGame(eventId, gameId) {
        const event = this.db.getEvent(eventId);
        if (!event)
            return { success: false, reason: 'Event not found' };
        const game = event.games.find(g => g.id === gameId);
        if (!game)
            return { success: false, reason: 'Game not found' };
        if (game.completed)
            return { success: false, reason: 'Game already completed' };
        game.started = true;
        game.startedAt = new Date();
        return { success: true, game };
    }
    endGame(eventId, gameId, scores) {
        const event = this.db.getEvent(eventId);
        if (!event)
            return { success: false, reason: 'Event not found' };
        const game = event.games.find(g => g.id === gameId);
        if (!game)
            return { success: false, reason: 'Game not found' };
        if (game.completed)
            return { success: false, reason: 'Game already completed' };
        if (!game.started)
            return { success: false, reason: 'Game has not started yet' };
        if (scores?.score_team1 !== undefined && scores?.score_team2 !== undefined) {
            game.scores = [scores.score_team1, scores.score_team2];
        }
        if (game.scores === undefined) {
            return { success: false, reason: 'Scores have not been provided yet', blockingConstraints: ['Score is required'] };
        }
        const [team1, team2] = game.scores;
        if ((team1 < 11 && team2 < 11) || Math.abs(team1 - team2) < 2) {
            return { success: false, reason: 'Invalid score: one team must reach at least 11 and win by 2', blockingConstraints: ['Score validation failed'] };
        }
        game.completed = true;
        game.completedAt = new Date();
        event.gameHistory.push({ ...game, players: { ...game.players, team1: [...game.players.team1], team2: [...game.players.team2] } });
        const allPlayerIds = [...game.players.team1, ...game.players.team2];
        const team1Ids = new Set(game.players.team1);
        for (const playerId of allPlayerIds) {
            const reg = event.getRegistration(playerId);
            if (reg) {
                reg.gamesPlayedCount++;
                reg.status = 'WAITING';
                const teammate = allPlayerIds.find(pid => pid !== playerId && team1Ids.has(pid) === team1Ids.has(playerId));
                if (teammate && !reg.partners.includes(teammate)) {
                    reg.partners.push(teammate);
                }
            }
        }
        event.recalculateTargetGames();
        return { success: true, game };
    }
}
exports.SchedulingService = SchedulingService;
//# sourceMappingURL=SchedulingService.js.map