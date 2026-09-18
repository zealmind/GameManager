"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Event = void 0;
exports.teamKey = teamKey;
const node_crypto_1 = require("node:crypto");
function teamKey(playerIdA, playerIdB) {
    return playerIdA < playerIdB ? `${playerIdA}|${playerIdB}` : `${playerIdB}|${playerIdA}`;
}
class Event {
    id;
    name;
    format;
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
    constructor(name, totalGamesToPlay, numCourts, format = 'ROTATING_DOUBLES') {
        this.id = (0, node_crypto_1.randomUUID)();
        this.name = name;
        this.format = format;
        this.players = new Map();
        this.registrations = new Map();
        this.games = []; // currently active games (max courts)
        this.courts = numCourts;
        this.totalGamesToPlay = totalGamesToPlay;
        this.gameHistory = []; // completed games
        this.nextGameNumber = 1;
        this.sharedAccess = [];
    }
    isFixedPartnerDoubles() {
        return this.format === 'FIXED_PARTNER_DOUBLES';
    }
    isSinglesRoundRobin() {
        return this.format === 'SINGLES_ROUND_ROBIN';
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
    validateCanStart() {
        if (this.isFixedPartnerDoubles()) {
            const teams = this.getTeams();
            if (teams.length < 2) {
                return { ok: false, error: 'Need at least 2 teams to start' };
            }
            if (this.registrations.size % 2 !== 0) {
                return { ok: false, error: 'Every player must have a partner' };
            }
            for (const reg of this.registrations.values()) {
                if (!reg.fixedPartnerId || !this.registrations.has(reg.fixedPartnerId)) {
                    return { ok: false, error: 'Every player must have a partner' };
                }
                if (reg.fixedPartnerId === reg.playerId) {
                    return { ok: false, error: 'Every player must have a partner' };
                }
            }
            return { ok: true };
        }
        if (this.registrations.size < 4) {
            return { ok: false, error: 'Need at least 4 players to start' };
        }
        return { ok: true };
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
    getTeamMate(playerId) {
        const reg = this.registrations.get(playerId);
        return reg?.fixedPartnerId;
    }
    getTeams() {
        if (!this.isFixedPartnerDoubles())
            return [];
        const seen = new Set();
        const teams = [];
        for (const reg of this.registrations.values()) {
            if (!reg.fixedPartnerId)
                continue;
            const key = teamKey(reg.playerId, reg.fixedPartnerId);
            if (seen.has(key))
                continue;
            seen.add(key);
            const mateReg = this.registrations.get(reg.fixedPartnerId);
            const gamesPlayed = reg.gamesPlayedCount;
            const targetGames = reg.targetGames;
            const status = reg.status;
            const priority = reg.priority;
            teams.push({
                id: key,
                playerIds: reg.playerId < reg.fixedPartnerId
                    ? [reg.playerId, reg.fixedPartnerId]
                    : [reg.fixedPartnerId, reg.playerId],
                gamesPlayed,
                targetGames,
                status: mateReg && mateReg.status !== status ? this.mergeTeamStatus(reg.status, mateReg.status) : status,
                priority: Math.max(priority, mateReg?.priority ?? priority),
            });
        }
        return teams;
    }
    mergeTeamStatus(a, b) {
        const order = ['PLAYING', 'WAITING', 'FULLFILLED', 'AWAY', 'UNAVAILABLE', 'RETIRED'];
        const rank = (s) => order.indexOf(s);
        return rank(a) <= rank(b) ? a : b;
    }
    isRegisteredPair(playerIds) {
        if (playerIds.length !== 2)
            return false;
        const [a, b] = playerIds;
        const regA = this.registrations.get(a);
        const regB = this.registrations.get(b);
        return !!regA && !!regB && regA.fixedPartnerId === b && regB.fixedPartnerId === a;
    }
    addTeam(playerA, playerB) {
        if (playerA.id === playerB.id) {
            throw new Error('A team cannot include the same player twice');
        }
        this.addPlayer(playerA);
        this.addPlayer(playerB);
        const regA = this.registrations.get(playerA.id);
        const regB = this.registrations.get(playerB.id);
        regA.fixedPartnerId = playerB.id;
        regB.fixedPartnerId = playerA.id;
    }
    // Player registration
    addPlayer(player) {
        if (!this.players.has(player.id)) {
            this.players.set(player.id, player);
            const registration = {
                eventId: this.id,
                playerId: player.id,
                gamesPlayedCount: 0,
                status: this.isStarted() ? 'WAITING' : 'WAITING',
                targetGames: this.calculateInitialTargetGames(),
                partners: [],
                priority: 10,
                consecutiveGamesPlayed: 0,
            };
            this.registrations.set(player.id, registration);
        }
    }
    removeTeam(playerId) {
        const mateId = this.getTeamMate(playerId);
        if (this.isStarted()) {
            const reg = this.registrations.get(playerId);
            const mateReg = mateId ? this.registrations.get(mateId) : undefined;
            if ((reg && reg.status === 'PLAYING') || (mateReg && mateReg.status === 'PLAYING')) {
                throw new Error('Cannot remove a team that is currently playing');
            }
            if (reg)
                reg.status = 'RETIRED';
            if (mateReg)
                mateReg.status = 'RETIRED';
            return;
        }
        this.players.delete(playerId);
        this.registrations.delete(playerId);
        if (mateId) {
            this.players.delete(mateId);
            this.registrations.delete(mateId);
        }
    }
    removePlayer(playerId) {
        if (this.isFixedPartnerDoubles()) {
            this.removeTeam(playerId);
            return;
        }
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
    setTeamStatus(playerId, status, extra) {
        const mateId = this.getTeamMate(playerId);
        const ids = mateId ? [playerId, mateId] : [playerId];
        for (const id of ids) {
            this.updateRegistration(id, { status, ...extra });
        }
    }
    syncTeamRegistration(playerId, fields) {
        const mateId = this.getTeamMate(playerId);
        this.updateRegistration(playerId, fields);
        if (mateId) {
            this.updateRegistration(mateId, fields);
        }
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
    calculateInitialTargetGames() {
        return this.totalGamesToPlay;
    }
    recalculateTargetGames() {
        const availablePlayers = Array.from(this.registrations.values()).filter(r => !['UNAVAILABLE', 'AWAY', 'RETIRED'].includes(r.status));
        availablePlayers.forEach(reg => {
            this.updateRegistration(reg.playerId, { targetGames: this.totalGamesToPlay });
        });
    }
    getAvailablePlayers() {
        if (this.isFixedPartnerDoubles()) {
            const teams = this.getTeams().filter(t => t.status === 'WAITING');
            const players = [];
            for (const team of teams) {
                for (const pid of team.playerIds) {
                    const player = this.players.get(pid);
                    if (player)
                        players.push(player);
                }
            }
            return players;
        }
        return Array.from(this.players.values())
            .filter(player => {
            const reg = this.registrations.get(player.id);
            return reg && reg.status === 'WAITING';
        });
    }
    getAverageGamesPlayed() {
        if (this.isFixedPartnerDoubles()) {
            const teams = this.getTeams();
            if (teams.length === 0)
                return 0;
            const total = teams.reduce((sum, team) => sum + team.gamesPlayed, 0);
            return total / teams.length;
        }
        const registrations = Array.from(this.registrations.values());
        if (registrations.length === 0)
            return 0;
        const total = registrations.reduce((sum, reg) => sum + reg.gamesPlayedCount, 0);
        return total / registrations.length;
    }
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
            return deficitB - deficitA;
        });
    }
    isComplete() {
        return this.isEnded();
    }
}
exports.Event = Event;
//# sourceMappingURL=Event.js.map