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
    nextGameNumber;
    startedAt;
    endedAt;
    sharedAccess;
    constructor(name, totalGamesToPlay, numCourts) {
        this.id = (0, node_crypto_1.randomUUID)();
        this.name = name;
        this.players = new Map();
        this.registrations = new Map();
        this.games = []; // currently active games (max courts)
        this.courts = numCourts;
        this.totalGamesToPlay = totalGamesToPlay;
        this.gameHistory = []; // completed games
        this.nextGameNumber = 1;
        this.sharedAccess = [];
    }
    isStarted() {
        return !!this.startedAt;
    }
    isEnded() {
        return !!this.endedAt;
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
        this.assignNickNames();
    }
    /** Assign unique per-event nicknames on registrations. Returns true if any changed. */
    assignNickNames() {
        const regs = Array.from(this.registrations.values());
        const nickCounts = new Map();
        for (const reg of regs) {
            if (!reg.nickName)
                continue;
            nickCounts.set(reg.nickName, (nickCounts.get(reg.nickName) || 0) + 1);
        }
        let changed = false;
        // Collisions (e.g. migrated global nicknames) — clear and reassign all
        if ([...nickCounts.values()].some(c => c > 1)) {
            for (const reg of regs)
                delete reg.nickName;
            changed = true;
        }
        const usedLetters = new Set(regs.map(r => r.nickName).filter((n) => !!n));
        const unassigned = regs.filter(r => !r.nickName);
        if (unassigned.length === 0)
            return changed;
        let nextCode = 65;
        const nextLetter = () => {
            while (usedLetters.has(String.fromCharCode(nextCode)))
                nextCode++;
            const letter = String.fromCharCode(nextCode);
            usedLetters.add(letter);
            nextCode++;
            return letter;
        };
        const shuffled = [...unassigned];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        shuffled.forEach(r => { r.nickName = nextLetter(); });
        return true;
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
                priority: 10,
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
    // Each player should get at least totalGamesToPlay games
    calculateInitialTargetGames() {
        return this.totalGamesToPlay;
    }
    // Recalculate target games for all players based on current registration count
    // Each available player should get at least totalGamesToPlay games
    recalculateTargetGames() {
        const availablePlayers = Array.from(this.registrations.values()).filter(r => !['UNAVAILABLE', 'AWAY', 'RETIRED'].includes(r.status));
        availablePlayers.forEach(reg => {
            this.updateRegistration(reg.playerId, { targetGames: this.totalGamesToPlay });
        });
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
    isComplete() {
        return this.isEnded();
    }
}
exports.Event = Event;
//# sourceMappingURL=Event.js.map