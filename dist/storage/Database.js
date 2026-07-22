"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Database = void 0;
const client_1 = require("@libsql/client");
const Player_1 = require("../models/Player");
const Event_1 = require("../models/Event");
class Database {
    static instance;
    players;
    events;
    eventRegistrations;
    client;
    nextNickNameIndex = 0;
    nickLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    constructor() {
        this.players = new Map();
        this.events = new Map();
        this.eventRegistrations = new Map();
        this.client = (0, client_1.createClient)({
            url: process.env.TURSO_DATABASE_URL || 'libsql://test',
            authToken: process.env.TURSO_AUTH_TOKEN,
        });
    }
    static getInstance() {
        if (!Database.instance) {
            Database.instance = new Database();
        }
        return Database.instance;
    }
    assignNickName() {
        const letter = this.nickLetters[this.nextNickNameIndex % this.nickLetters.length];
        this.nextNickNameIndex++;
        return String(letter);
    }
    async init() {
        await this.client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        nickName TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        courts INTEGER NOT NULL,
        totalGamesToPlay INTEGER NOT NULL,
        startedAt TEXT
      );
      CREATE TABLE IF NOT EXISTS registrations (
        eventId TEXT NOT NULL,
        playerId TEXT NOT NULL,
        gamesPlayedCount INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'WAITING',
        targetGames INTEGER NOT NULL DEFAULT 6,
        partners TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (eventId, playerId)
      );
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        eventId TEXT NOT NULL,
        courtId INTEGER NOT NULL,
        players TEXT NOT NULL,
        scores TEXT,
        createdAt TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        started INTEGER NOT NULL DEFAULT 0,
        startedAt TEXT,
        completedAt TEXT
      );
      CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY,
        data TEXT NOT NULL
      );
    `);
        await this.load();
    }
    async persist() {
        const playersData = Array.from(this.players.values()).map(p => ({ id: p.id, name: p.name, nickName: p.nickName }));
        const eventsData = Array.from(this.events.values()).map(e => ({
            id: e.id,
            name: e.name,
            courts: e.courts,
            totalGamesToPlay: e.totalGamesToPlay,
            startedAt: e.startedAt ? e.startedAt.toISOString() : undefined,
            players: Array.from(e.players.values()).map(p => ({ id: p.id, name: p.name, nickName: p.nickName })),
            registrations: Array.from(e.registrations.values()),
            games: e.games.map(g => ({
                ...g,
                createdAt: g.createdAt.toISOString(),
                startedAt: g.startedAt ? g.startedAt.toISOString() : undefined,
                completedAt: g.completedAt?.toISOString()
            })),
            gameHistory: e.gameHistory.map(g => ({
                ...g,
                createdAt: g.createdAt.toISOString(),
                startedAt: g.startedAt ? g.startedAt.toISOString() : undefined,
                completedAt: g.completedAt?.toISOString()
            }))
        }));
        const registrationsData = Array.from(this.eventRegistrations.values());
        const data = { players: playersData, events: eventsData, eventRegistrations: registrationsData };
        const json = JSON.stringify(data, null, 2);
        await this.client.execute('INSERT OR REPLACE INTO app_state (id, data) VALUES (?, ?)', [1, json]);
    }
    async load() {
        try {
            const result = await this.client.execute('SELECT data FROM app_state WHERE id = ?', [1]);
            if (result.rows.length === 0)
                return;
            const raw = result.rows[0].data;
            const data = JSON.parse(raw);
            if (!data)
                return;
            for (const p of data.players) {
                const nick = p.nickName || this.assignNickName();
                this.players.set(p.id, new Player_1.Player(p.name, p.id, nick));
            }
            for (const e of data.events) {
                const event = new Event_1.Event(e.name, e.totalGamesToPlay, e.courts);
                event.id = e.id;
                event.startedAt = e.startedAt ? new Date(e.startedAt) : undefined;
                for (const p of e.players) {
                    const player = this.players.get(p.id) || new Player_1.Player(p.name, p.id, p.nickName || this.assignNickName());
                    if (!this.players.has(player.id)) {
                        this.players.set(player.id, player);
                    }
                    event.players.set(player.id, player);
                }
                for (const r of e.registrations) {
                    event.registrations.set(r.playerId, r);
                }
                event.games = e.games.map(g => ({
                    ...g,
                    createdAt: new Date(g.createdAt),
                    startedAt: g.startedAt ? new Date(g.startedAt) : undefined,
                    completedAt: g.completedAt ? new Date(g.completedAt) : undefined
                }));
                event.gameHistory = e.gameHistory.map(g => ({
                    ...g,
                    createdAt: new Date(g.createdAt),
                    startedAt: g.startedAt ? new Date(g.startedAt) : undefined,
                    completedAt: g.completedAt ? new Date(g.completedAt) : undefined
                }));
                this.events.set(event.id, event);
            }
            for (const r of data.eventRegistrations) {
                this.eventRegistrations.set(`${r.eventId}_${r.playerId}`, r);
            }
        }
        catch (err) {
            console.error('Failed to load database', err);
        }
    }
    // Player operations
    getPlayer(playerId) {
        return this.players.get(playerId);
    }
    getAllPlayers() {
        return Array.from(this.players.values());
    }
    async createPlayer(name) {
        const nick = this.assignNickName();
        const player = new Player_1.Player(name, undefined, nick);
        this.players.set(player.id, player);
        await this.persist();
        return player;
    }
    findPlayerByName(name) {
        return Array.from(this.players.values()).find(p => p.name === name);
    }
    // Event operations
    getEvent(eventId) {
        return this.events.get(eventId);
    }
    getAllEvents() {
        return Array.from(this.events.values());
    }
    async createEvent(name, totalGamesToPlay, numCourts) {
        const event = new Event_1.Event(name, totalGamesToPlay, numCourts);
        this.events.set(event.id, event);
        await this.persist();
        return event;
    }
    // Event Player Registration operations
    getEventRegistration(eventId, playerId) {
        return this.eventRegistrations.get(`${eventId}_${playerId}`);
    }
    getAllEventRegistrations(eventId) {
        return Array.from(this.eventRegistrations.values()).filter(r => r.eventId === eventId);
    }
    async createEventRegistration(eventId, playerId, targetGames) {
        const key = `${eventId}_${playerId}`;
        const registration = {
            eventId,
            playerId,
            gamesPlayedCount: 0,
            status: 'WAITING',
            targetGames,
            partners: [],
        };
        this.eventRegistrations.set(key, registration);
        await this.persist();
        return registration;
    }
    async updateEventRegistration(eventId, playerId, updates) {
        const key = `${eventId}_${playerId}`;
        const existing = this.eventRegistrations.get(key);
        if (!existing)
            return undefined;
        const updated = { ...existing, ...updates };
        this.eventRegistrations.set(key, updated);
        await this.persist();
        return updated;
    }
    // Game operations
    getCompletedGames(eventId) {
        const event = this.events.get(eventId);
        return event?.gameHistory || [];
    }
    async deletePlayer(playerId) {
        this.players.delete(playerId);
        for (const event of this.events.values()) {
            event.removePlayer(playerId);
        }
        for (const key of Array.from(this.eventRegistrations.keys())) {
            if (key.endsWith(`_${playerId}`)) {
                this.eventRegistrations.delete(key);
            }
        }
        await this.persist();
    }
    async deleteEvent(eventId) {
        this.events.delete(eventId);
        for (const key of Array.from(this.eventRegistrations.keys())) {
            if (key.startsWith(`${eventId}_`)) {
                this.eventRegistrations.delete(key);
            }
        }
        await this.persist();
    }
    // Clear all data (useful for testing)
    async clear() {
        this.players.clear();
        this.events.clear();
        this.eventRegistrations.clear();
        this.nextNickNameIndex = 0;
        await this.client.execute('DELETE FROM app_state WHERE id = ?', [1]);
    }
}
exports.Database = Database;
//# sourceMappingURL=Database.js.map