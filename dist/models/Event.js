"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Event = void 0;
const node_crypto_1 = require("node:crypto");
class Event {
    id;
    name;
    players; // playerId -> Player (registered in this event)
    registrations; // playerId -> EventPlayerRegistration
    games;
    courts;
    totalGamesToPlay;
    gameHistory; // completed games
    startedAt;
    constructor(name, totalGamesToPlay, numCourts) {
        this.id = (0, node_crypto_1.randomUUID)();
        this.name = name;
        this.players = new Map();
        this.registrations = new Map();
        this.games = []; // currently active games (max courts)
        this.courts = numCourts;
        this.totalGamesToPlay = totalGamesToPlay;
        this.gameHistory = []; // completed games
    }
    isStarted() {
        return !!this.startedAt;
    }
    start() {
        if (this.isStarted())
            return;
        this.startedAt = new Date();
        for (const reg of this.registrations.values()) {
            if (reg.status !== 'RETIRED') {
                reg.status = 'WAITING';
            }
        }
    }
    // Player registration
    addPlayer(player) {
        if (!this.players.has(player.id)) {
            this.players.set(player.id, player);
            // Initialize registration for this player in this event
            const registration = {
                eventId: this.id,
                playerId: player.id,
                gamesPlayedCount: 0,
                status: this.isStarted() ? 'WAITING' : 'WAITING',
                targetGames: this.calculateInitialTargetGames(),
                partners: [],
            };
            this.registrations.set(player.id, registration);
        }
    }
    removePlayer(playerId) {
        if (this.isStarted()) {
            const reg = this.registrations.get(playerId);
            if (reg && reg.status === 'PLAYING') {
                throw new Error('Cannot remove a player who is currently playing');
            }
            this.registrations.get(playerId) && (this.registrations.get(playerId).status = 'RETIRED');
            return;
        }
        this.players.delete(playerId);
        this.registrations.delete(playerId);
    }
    getPlayer(playerId) {
        return this.players.get(playerId);
    }
    getRegistration(playerId) {
        return this.registrations.get(playerId);
    }
    updateRegistration(playerId, updates) {
        const registration = this.registrations.get(playerId);
        if (!registration)
            return undefined;
        const updated = { ...registration, ...updates };
        this.registrations.set(playerId, updated);
        return updated;
    }
    // Calculate initial target games for a new player
    // Each player should get at least 6 games; remaining games distributed
    calculateInitialTargetGames() {
        const playerCount = Math.max(this.players.size, 1);
        const baseTarget = Math.floor(this.totalGamesToPlay / playerCount);
        return Math.max(baseTarget, 6); // minimum 6 games per player
    }
    // Recalculate target games for all players based on current registration count
    // This implements dynamic adjustment when availability changes
    recalculateTargetGames() {
        const playerCount = this.players.size;
        if (playerCount === 0)
            return;
        const totalTargetGames = this.totalGamesToPlay;
        const minGamesPerPlayer = 6;
        // Calculate how many players can get the minimum, and how many extra games to distribute
        const availablePlayers = Array.from(this.registrations.values()).filter(r => !['UNAVAILABLE', 'AWAY', 'RETIRED'].includes(r.status));
        const availableCount = availablePlayers.length;
        if (availableCount === 0)
            return;
        const minTotal = availableCount * minGamesPerPlayer;
        if (totalTargetGames <= minTotal) {
            // Not enough games for everyone to get 6, distribute equally
            const baseTarget = Math.floor(totalTargetGames / availableCount);
            const remainder = totalTargetGames % availableCount;
            availablePlayers.forEach((reg, index) => {
                const target = baseTarget + (index < remainder ? 1 : 0);
                this.updateRegistration(reg.playerId, { targetGames: target });
            });
        }
        else {
            // Everyone gets at least 6, distribute remaining games
            const remainingGames = totalTargetGames - minTotal;
            const extraPerPlayer = Math.floor(remainingGames / availableCount);
            const extraRemainder = remainingGames % availableCount;
            availablePlayers.forEach((reg, index) => {
                const target = minGamesPerPlayer + extraPerPlayer + (index < extraRemainder ? 1 : 0);
                this.updateRegistration(reg.playerId, { targetGames: target });
            });
        }
    }
    // Helper methods for scheduling logic
    getAvailablePlayers() {
        return Array.from(this.players.values())
            .filter(player => {
            const reg = this.registrations.get(player.id);
            return reg && reg.status === 'WAITING';
        });
    }
    getAverageGamesPlayed() {
        const registrations = Array.from(this.registrations.values());
        if (registrations.length === 0)
            return 0;
        const total = registrations.reduce((sum, reg) => sum + reg.gamesPlayedCount, 0);
        return total / registrations.length;
    }
    // Get players sorted by how far below average they are (most negative first)
    // Excludes UNAVAILABLE, AWAY, and RETIRED players
    getPlayersSortedByDeficit() {
        const avg = this.getAverageGamesPlayed();
        const availableRegs = Array.from(this.registrations.values())
            .filter(reg => !['UNAVAILABLE', 'AWAY', 'RETIRED'].includes(reg.status));
        return availableRegs
            .map(reg => this.players.get(reg.playerId))
            .sort((a, b) => {
            const regA = this.registrations.get(a.id);
            const regB = this.registrations.get(b.id);
            const deficitA = avg - regA.gamesPlayedCount;
            const deficitB = avg - regB.gamesPlayedCount;
            return deficitB - deficitA; // most negative deficit first
        });
    }
    // Check if event is complete
    isComplete() {
        // Event completes when total games played reaches target AND distribution is as fair as possible
        // For simplicity, we consider complete when we've played totalGamesToPlay games
        return this.gameHistory.length >= this.totalGamesToPlay;
    }
}
exports.Event = Event;
//# sourceMappingURL=Event.js.map