"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Database = void 0;
const client_1 = require("@libsql/client");
const Player_1 = require("../models/Player");
const Event_1 = require("../models/Event");
const node_crypto_1 = __importDefault(require("node:crypto"));
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
        const dbUrl = process.env.TURSO_DATABASE_URL;
        if (!dbUrl) {
            throw new Error('TURSO_DATABASE_URL is required');
        }
        this.client = (0, client_1.createClient)({
            url: dbUrl,
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
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT,
        provider TEXT NOT NULL DEFAULT 'local',
        provider_id TEXT,
        avatar_url TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        nickName TEXT,
        owner_id TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        courts INTEGER NOT NULL,
        totalGamesToPlay INTEGER NOT NULL,
        startedAt TEXT,
        owner_id TEXT
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
        await this.migrateAddOwnerId();
        await this.load();
    }
    async migrateAddOwnerId() {
        try {
            await this.client.execute("ALTER TABLE events ADD COLUMN owner_id TEXT");
        }
        catch {
            // column already exists
        }
        try {
            await this.client.execute("ALTER TABLE players ADD COLUMN owner_id TEXT");
        }
        catch {
            // column already exists
        }
    }
    async persist() {
        const playersData = Array.from(this.players.values()).map(p => ({ id: p.id, name: p.name, nickName: p.nickName, ownerId: p.ownerId }));
        const eventsData = Array.from(this.events.values()).map(e => ({
            id: e.id,
            name: e.name,
            courts: e.courts,
            totalGamesToPlay: e.totalGamesToPlay,
            startedAt: e.startedAt ? e.startedAt.toISOString() : undefined,
            ownerId: e.ownerId || '',
            players: Array.from(e.players.values()).map(p => ({ id: p.id, name: p.name, nickName: p.nickName, ownerId: p.ownerId })),
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
                const player = new Player_1.Player(p.name, p.id, nick);
                player.ownerId = p.ownerId;
                this.players.set(p.id, player);
            }
            for (const e of data.events) {
                const event = new Event_1.Event(e.name, e.totalGamesToPlay, e.courts);
                event.id = e.id;
                event.startedAt = e.startedAt ? new Date(e.startedAt) : undefined;
                event.ownerId = e.ownerId;
                for (const p of e.players) {
                    const player = this.players.get(p.id) || new Player_1.Player(p.name, p.id, p.nickName || this.assignNickName());
                    if (!this.players.has(player.id)) {
                        player.ownerId = p.ownerId;
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
    // User operations
    async createUser(email, name, provider, providerId, avatarUrl) {
        const id = node_crypto_1.default.randomUUID();
        await this.client.execute('INSERT INTO users (id, email, name, provider, provider_id, avatar_url) VALUES (?, ?, ?, ?, ?, ?)', [id, email, name, provider, providerId || null, avatarUrl || null]);
        return { id };
    }
    async getUserByEmail(email) {
        const result = await this.client.execute('SELECT id, email, name, provider, password_hash FROM users WHERE email = ?', [email]);
        if (result.rows.length === 0)
            return undefined;
        const row = result.rows[0];
        return { id: row.id, email: row.email, name: row.name, provider: row.provider, password_hash: row.password_hash };
    }
    async getUserByProvider(provider, providerId) {
        const result = await this.client.execute('SELECT id, email, name, provider FROM users WHERE provider = ? AND provider_id = ?', [provider, providerId]);
        if (result.rows.length === 0)
            return undefined;
        const row = result.rows[0];
        return { id: row.id, email: row.email, name: row.name, provider: row.provider };
    }
    async getUserById(id) {
        const result = await this.client.execute('SELECT id, email, name, provider, avatar_url FROM users WHERE id = ?', [id]);
        if (result.rows.length === 0)
            return undefined;
        const row = result.rows[0];
        return { id: row.id, email: row.email, name: row.name, provider: row.provider, avatar_url: row.avatar_url };
    }
    async updateUserPassword(userId, passwordHash) {
        await this.client.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
    }
    // Player operations
    getPlayer(playerId) {
        return this.players.get(playerId);
    }
    getAllPlayers() {
        return Array.from(this.players.values());
    }
    getPlayersByOwner(ownerId) {
        return Array.from(this.players.values()).filter((p) => p.ownerId === ownerId);
    }
    async createPlayer(name, ownerId) {
        const nick = this.assignNickName();
        const player = new Player_1.Player(name, undefined, nick);
        player.ownerId = ownerId;
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
    getEventsByOwner(ownerId) {
        return Array.from(this.events.values()).filter((e) => e.ownerId === ownerId);
    }
    async createEvent(name, totalGamesToPlay, numCourts, ownerId) {
        const event = new Event_1.Event(name, totalGamesToPlay, numCourts);
        event.ownerId = ownerId;
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