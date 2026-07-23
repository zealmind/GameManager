import { createClient } from "@libsql/client";
import { Player } from '../models/Player';
import { Event } from '../models/Event';
import type { EventPlayerRegistration, PlayerStatus } from '../models/EventPlayerRegistration';
import type { Game } from '../models/Game';
import crypto from 'node:crypto';

interface SerializedPlayer {
  id: string;
  name: string;
  nickName: string;
  ownerId?: string;
}

interface SerializedGame {
  id: string;
  eventId: string;
  courtId: number;
  players: {
    team1: [string, string];
    team2: [string, string];
  };
  scores?: [number, number];
  createdAt: string;
  completed: boolean;
  started: boolean;
  startedAt?: string;
  completedAt?: string;
}

interface SerializedEvent {
  id: string;
  name: string;
  courts: number;
  totalGamesToPlay: number;
  startedAt?: string;
  ownerId: string;
  players: SerializedPlayer[];
  registrations: EventPlayerRegistration[];
  games: SerializedGame[];
  gameHistory: SerializedGame[];
}

export class Database {
  private static instance: Database;
  private players: Map<string, Player>;
  private events: Map<string, Event>;
  private eventRegistrations: Map<string, EventPlayerRegistration>;
  public client: ReturnType<typeof createClient>;
  private nextNickNameIndex = 0;
  private readonly nickLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  private constructor() {
    this.players = new Map<string, Player>();
    this.events = new Map<string, Event>();
    this.eventRegistrations = new Map<string, EventPlayerRegistration>();
    
    const dbUrl = process.env.TURSO_DATABASE_URL;
    if (!dbUrl) {
      throw new Error('TURSO_DATABASE_URL is required');
    }
    this.client = createClient({
      url: dbUrl,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }

  static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  private assignNickName(): string {
    const letter = this.nickLetters[this.nextNickNameIndex % this.nickLetters.length];
    this.nextNickNameIndex++;
    return String(letter);
  }

  async init(): Promise<void> {
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

  private async migrateAddOwnerId(): Promise<void> {
    try {
      await this.client.execute("ALTER TABLE events ADD COLUMN owner_id TEXT");
    } catch {
      // column already exists
    }
    try {
      await this.client.execute("ALTER TABLE players ADD COLUMN owner_id TEXT");
    } catch {
      // column already exists
    }
  }

  public async persist(): Promise<void> {
    const playersData = Array.from(this.players.values()).map<SerializedPlayer>(p => ({ id: p.id, name: p.name, nickName: p.nickName, ownerId: (p as any).ownerId }));
    const eventsData = Array.from(this.events.values()).map<SerializedEvent>(e => ({
      id: e.id,
      name: e.name,
      courts: e.courts,
      totalGamesToPlay: e.totalGamesToPlay,
      startedAt: e.startedAt ? e.startedAt.toISOString() : undefined,
      ownerId: (e as any).ownerId || '',
      players: Array.from(e.players.values()).map<SerializedPlayer>(p => ({ id: p.id, name: p.name, nickName: p.nickName, ownerId: (p as any).ownerId })),
      registrations: Array.from(e.registrations.values()),
      games: e.games.map<SerializedGame>(g => ({
        ...g,
        createdAt: g.createdAt.toISOString(),
        startedAt: g.startedAt ? g.startedAt.toISOString() : undefined,
        completedAt: g.completedAt?.toISOString()
      })),
      gameHistory: e.gameHistory.map<SerializedGame>(g => ({
        ...g,
        createdAt: g.createdAt.toISOString(),
        startedAt: g.startedAt ? g.startedAt.toISOString() : undefined,
        completedAt: g.completedAt?.toISOString()
      }))
    }));
    const registrationsData = Array.from(this.eventRegistrations.values());

    const data = { players: playersData, events: eventsData, eventRegistrations: registrationsData };
    const json = JSON.stringify(data, null, 2);

    await this.client.execute(
      'INSERT OR REPLACE INTO app_state (id, data) VALUES (?, ?)',
      [1, json]
    );
  }

  private async load(): Promise<void> {
    try {
      const result = await this.client.execute('SELECT data FROM app_state WHERE id = ?', [1]);
      
      if (result.rows.length === 0) return;

      const raw = result.rows[0].data as string;
      const data = JSON.parse(raw) as {
        players: SerializedPlayer[];
        events: SerializedEvent[];
        eventRegistrations: EventPlayerRegistration[];
      };
      if (!data) return;

      for (const p of data.players) {
        const nick = p.nickName || this.assignNickName();
        const player = new Player(p.name, p.id, nick);
        (player as any).ownerId = p.ownerId;
        this.players.set(p.id, player);
      }

      for (const e of data.events) {
        const event = new Event(e.name, e.totalGamesToPlay, e.courts);
        event.id = e.id;
        event.startedAt = e.startedAt ? new Date(e.startedAt) : undefined;
        (event as any).ownerId = e.ownerId;

        for (const p of e.players) {
          const player = this.players.get(p.id) || new Player(p.name, p.id, p.nickName || this.assignNickName());
          if (!this.players.has(player.id)) {
            (player as any).ownerId = p.ownerId;
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
    } catch (err) {
      console.error('Failed to load database', err);
    }
  }

  // User operations
  async createUser(email: string, name: string, provider: string, providerId?: string, avatarUrl?: string): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    await this.client.execute(
      'INSERT INTO users (id, email, name, provider, provider_id, avatar_url) VALUES (?, ?, ?, ?, ?, ?)',
      [id, email, name, provider, providerId || null, avatarUrl || null]
    );
    return { id };
  }

  async getUserByEmail(email: string): Promise<{ id: string; email: string; name: string; provider: string; password_hash?: string } | undefined> {
    const result = await this.client.execute('SELECT id, email, name, provider, password_hash FROM users WHERE email = ?', [email]);
    if (result.rows.length === 0) return undefined;
    const row = result.rows[0] as any;
    return { id: row.id, email: row.email, name: row.name, provider: row.provider, password_hash: row.password_hash };
  }

  async getUserByProvider(provider: string, providerId: string): Promise<{ id: string; email: string; name: string; provider: string } | undefined> {
    const result = await this.client.execute('SELECT id, email, name, provider FROM users WHERE provider = ? AND provider_id = ?', [provider, providerId]);
    if (result.rows.length === 0) return undefined;
    const row = result.rows[0] as any;
    return { id: row.id, email: row.email, name: row.name, provider: row.provider };
  }

  async getUserById(id: string): Promise<{ id: string; email: string; name: string; provider: string; avatar_url?: string } | undefined> {
    const result = await this.client.execute('SELECT id, email, name, provider, avatar_url FROM users WHERE id = ?', [id]);
    if (result.rows.length === 0) return undefined;
    const row = result.rows[0] as any;
    return { id: row.id, email: row.email, name: row.name, provider: row.provider, avatar_url: row.avatar_url };
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    await this.client.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
  }

  // Player operations
  getPlayer(playerId: string): Player | undefined {
    return this.players.get(playerId);
  }

  getAllPlayers(): Player[] {
    return Array.from(this.players.values());
  }

  getPlayersByOwner(ownerId: string): Player[] {
    return Array.from(this.players.values()).filter((p: any) => p.ownerId === ownerId);
  }

  async createPlayer(name: string, ownerId: string): Promise<Player> {
    const nick = this.assignNickName();
    const player = new Player(name, undefined, nick);
    (player as any).ownerId = ownerId;
    this.players.set(player.id, player);
    await this.persist();
    return player;
  }

  findPlayerByName(name: string): Player | undefined {
    return Array.from(this.players.values()).find(p => p.name === name);
  }

  // Event operations
  getEvent(eventId: string): Event | undefined {
    return this.events.get(eventId);
  }

  getAllEvents(): Event[] {
    return Array.from(this.events.values());
  }

  getEventsByOwner(ownerId: string): Event[] {
    return Array.from(this.events.values()).filter((e: any) => e.ownerId === ownerId);
  }

  async createEvent(name: string, totalGamesToPlay: number, numCourts: number, ownerId: string): Promise<Event> {
    const event = new Event(name, totalGamesToPlay, numCourts);
    (event as any).ownerId = ownerId;
    this.events.set(event.id, event);
    await this.persist();
    return event;
  }

  // Event Player Registration operations
  getEventRegistration(eventId: string, playerId: string): EventPlayerRegistration | undefined {
    return this.eventRegistrations.get(`${eventId}_${playerId}`);
  }

  getAllEventRegistrations(eventId: string): EventPlayerRegistration[] {
    return Array.from(this.eventRegistrations.values()).filter(r => r.eventId === eventId);
  }

  async createEventRegistration(eventId: string, playerId: string, targetGames: number): Promise<EventPlayerRegistration> {
    const key = `${eventId}_${playerId}`;
    const registration: EventPlayerRegistration = {
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

  async updateEventRegistration(eventId: string, playerId: string, updates: Partial<Omit<EventPlayerRegistration, 'eventId' | 'playerId'>>): Promise<EventPlayerRegistration | undefined> {
    const key = `${eventId}_${playerId}`;
    const existing = this.eventRegistrations.get(key);
    if (!existing) return undefined;
    
    const updated = { ...existing, ...updates };
    this.eventRegistrations.set(key, updated);
    await this.persist();
    return updated;
  }

  // Game operations
  getCompletedGames(eventId: string): Game[] {
    const event = this.events.get(eventId);
    return event?.gameHistory || [];
  }

  async deletePlayer(playerId: string): Promise<void> {
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

  async deleteEvent(eventId: string): Promise<void> {
    this.events.delete(eventId);
    for (const key of Array.from(this.eventRegistrations.keys())) {
      if (key.startsWith(`${eventId}_`)) {
        this.eventRegistrations.delete(key);
      }
    }
    await this.persist();
  }

  async clear(): Promise<void> {
    this.players.clear();
    this.events.clear();
    this.eventRegistrations.clear();
    this.nextNickNameIndex = 0;
    await this.client.execute('DELETE FROM app_state WHERE id = ?', [1]);
  }
}
