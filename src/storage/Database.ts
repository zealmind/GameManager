import { createClient } from "@libsql/client";
import { Player } from '../models/Player';
import { Event } from '../models/Event';
import type { EventPlayerRegistration } from '../models/EventPlayerRegistration';
import type { Game } from '../models/Game';
import crypto from 'node:crypto';

type ShareAccess = { token: string; permission: 'viewer' | 'moderator'; invitedBy: string; createdAt: string };

export class Database {
  private static instance: Database;
  private players: Map<string, Player>;
  private events: Map<string, Event>;
  private eventRegistrations: Map<string, EventPlayerRegistration>;
  public client: ReturnType<typeof createClient>;

  private constructor() {
    this.players = new Map<string, Player>();
    this.events = new Map<string, Event>();
    this.eventRegistrations = new Map<string, EventPlayerRegistration>();

    const dbUrl = process.env.TURSO_DATABASE_URL;
    if (!dbUrl && process.env.NODE_ENV !== 'test') {
      throw new Error('TURSO_DATABASE_URL is required');
    }
    this.client = createClient({
      url: dbUrl || 'libsql://test',
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }

  static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
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
        nick_name TEXT,
        owner_id TEXT,
        dupr_id TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        courts INTEGER NOT NULL,
        totalGamesToPlay INTEGER NOT NULL,
        startedAt TEXT,
        endedAt TEXT,
        owner_id TEXT
      );
      CREATE TABLE IF NOT EXISTS registrations (
        eventId TEXT NOT NULL,
        playerId TEXT NOT NULL,
        gamesPlayedCount INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'WAITING',
        targetGames INTEGER NOT NULL DEFAULT 6,
        partners TEXT NOT NULL DEFAULT '[]',
        priority INTEGER NOT NULL DEFAULT 10,
        nick_name TEXT,
        PRIMARY KEY (eventId, playerId)
      );
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        eventId TEXT NOT NULL,
        gameNumber INTEGER NOT NULL DEFAULT 0,
        courtId INTEGER NOT NULL,
        players TEXT NOT NULL,
        scores TEXT,
        createdAt TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        started INTEGER NOT NULL DEFAULT 0,
        startedAt TEXT,
        completedAt TEXT,
        in_history INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS shared_access (
        token TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        permission TEXT NOT NULL,
        invited_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    await this.migrateAddDuprId();
    await this.migrateAddRegistrationNickName();
    await this.load();
  }

  /** Add dupr_id to existing players tables that predate the column. */
  private async migrateAddDuprId(): Promise<void> {
    try {
      await this.client.execute('ALTER TABLE players ADD COLUMN dupr_id TEXT');
    } catch {
      // column already exists
    }
  }

  /** Add nick_name to existing registrations tables (per-event, not on shared players). */
  private async migrateAddRegistrationNickName(): Promise<void> {
    try {
      await this.client.execute('ALTER TABLE registrations ADD COLUMN nick_name TEXT');
    } catch {
      // column already exists
    }
  }

  private syncRegistrationIndex(event?: Event): void {
    if (event) {
      for (const key of Array.from(this.eventRegistrations.keys())) {
        if (key.startsWith(`${event.id}_`)) this.eventRegistrations.delete(key);
      }
      for (const reg of event.registrations.values()) {
        this.eventRegistrations.set(`${reg.eventId}_${reg.playerId}`, reg);
      }
      return;
    }
    this.eventRegistrations.clear();
    for (const e of this.events.values()) {
      for (const reg of e.registrations.values()) {
        this.eventRegistrations.set(`${reg.eventId}_${reg.playerId}`, reg);
      }
    }
  }

  private async batch(stmts: Array<{ sql: string; args?: any[] }>): Promise<void> {
    if (stmts.length === 0) return;
    if (typeof (this.client as any).batch === 'function') {
      await (this.client as any).batch(
        stmts.map(s => ({ sql: s.sql, args: s.args ?? [] })),
        'write'
      );
    } else {
      for (const s of stmts) {
        await this.client.execute(s.sql, s.args ?? []);
      }
    }
  }

  private playerUpsertStmt(player: Player): { sql: string; args: any[] } {
    return {
      sql: `INSERT INTO players (id, name, nick_name, owner_id, dupr_id) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              nick_name = NULL,
              owner_id = excluded.owner_id,
              dupr_id = excluded.dupr_id`,
      args: [
        player.id,
        player.name,
        null,
        player.ownerId ?? null,
        player.duprId ?? null,
      ],
    };
  }

  private registrationUpsertStmt(r: EventPlayerRegistration): { sql: string; args: any[] } {
    return {
      sql: `INSERT INTO registrations (eventId, playerId, gamesPlayedCount, status, targetGames, partners, priority, nick_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(eventId, playerId) DO UPDATE SET
              gamesPlayedCount = excluded.gamesPlayedCount,
              status = excluded.status,
              targetGames = excluded.targetGames,
              partners = excluded.partners,
              priority = excluded.priority,
              nick_name = excluded.nick_name`,
      args: [
        r.eventId,
        r.playerId,
        r.gamesPlayedCount,
        r.status,
        r.targetGames,
        JSON.stringify(r.partners || []),
        r.priority ?? 10,
        r.nickName ?? null,
      ],
    };
  }

  private gameUpsertStmt(g: Game, inHistory: boolean): { sql: string; args: any[] } {
    return {
      sql: `INSERT INTO games (
              id, eventId, gameNumber, courtId, players, scores, createdAt,
              completed, started, startedAt, completedAt, in_history
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              eventId = excluded.eventId,
              gameNumber = excluded.gameNumber,
              courtId = excluded.courtId,
              players = excluded.players,
              scores = excluded.scores,
              createdAt = excluded.createdAt,
              completed = excluded.completed,
              started = excluded.started,
              startedAt = excluded.startedAt,
              completedAt = excluded.completedAt,
              in_history = excluded.in_history`,
      args: [
        g.id,
        g.eventId,
        g.gameNumber ?? 0,
        g.courtId,
        JSON.stringify({
          ...g.players,
          ...(g.allotmentWarning ? { allotmentWarning: g.allotmentWarning } : {}),
        }),
        g.scores != null ? JSON.stringify(g.scores) : null,
        g.createdAt instanceof Date ? g.createdAt.toISOString() : g.createdAt,
        g.completed ? 1 : 0,
        g.started ? 1 : 0,
        g.startedAt ? (g.startedAt instanceof Date ? g.startedAt.toISOString() : g.startedAt) : null,
        g.completedAt ? (g.completedAt instanceof Date ? g.completedAt.toISOString() : g.completedAt) : null,
        inHistory ? 1 : 0,
      ],
    };
  }

  /** Persist a single player row. */
  async savePlayer(player: Player): Promise<void> {
    const stmt = this.playerUpsertStmt(player);
    await this.client.execute(stmt.sql, stmt.args);
  }

  /**
   * Persist one event and its related rows only (registrations, games, shares),
   * plus any players attached to the event.
   * Other events are left untouched for better concurrency.
   */
  async persistEvent(eventId: string): Promise<void> {
    const event = this.events.get(eventId);
    if (!event) throw new Error('Event not found');
    this.syncRegistrationIndex(event);

    const stmts: Array<{ sql: string; args?: any[] }> = [];

    for (const player of event.players.values()) {
      stmts.push(this.playerUpsertStmt(player));
    }

    stmts.push({
      sql: `INSERT INTO events (id, name, courts, totalGamesToPlay, startedAt, endedAt, owner_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              courts = excluded.courts,
              totalGamesToPlay = excluded.totalGamesToPlay,
              startedAt = excluded.startedAt,
              endedAt = excluded.endedAt,
              owner_id = excluded.owner_id`,
      args: [
        event.id,
        event.name,
        event.courts,
        event.totalGamesToPlay,
        event.startedAt ? event.startedAt.toISOString() : null,
        event.endedAt ? event.endedAt.toISOString() : null,
        (event as any).ownerId || null,
      ],
    });

    const regPlayerIds = Array.from(event.registrations.keys());
    if (regPlayerIds.length === 0) {
      stmts.push({ sql: 'DELETE FROM registrations WHERE eventId = ?', args: [event.id] });
    } else {
      stmts.push({
        sql: `DELETE FROM registrations WHERE eventId = ? AND playerId NOT IN (${regPlayerIds.map(() => '?').join(',')})`,
        args: [event.id, ...regPlayerIds],
      });
    }
    for (const reg of event.registrations.values()) {
      stmts.push(this.registrationUpsertStmt(reg));
    }

    const gamesById = new Map<string, { game: Game; inHistory: boolean }>();
    for (const g of event.games) {
      gamesById.set(g.id, { game: g, inHistory: !!g.completed });
    }
    for (const g of event.gameHistory) {
      gamesById.set(g.id, { game: g, inHistory: true });
    }
    const gameIds = Array.from(gamesById.keys());
    if (gameIds.length === 0) {
      stmts.push({ sql: 'DELETE FROM games WHERE eventId = ?', args: [event.id] });
    } else {
      stmts.push({
        sql: `DELETE FROM games WHERE eventId = ? AND id NOT IN (${gameIds.map(() => '?').join(',')})`,
        args: [event.id, ...gameIds],
      });
    }
    for (const { game, inHistory } of gamesById.values()) {
      stmts.push(this.gameUpsertStmt(game, inHistory));
    }

    const tokens = (event.sharedAccess || []).map(a => a.token);
    if (tokens.length === 0) {
      stmts.push({ sql: 'DELETE FROM shared_access WHERE event_id = ?', args: [event.id] });
    } else {
      stmts.push({
        sql: `DELETE FROM shared_access WHERE event_id = ? AND token NOT IN (${tokens.map(() => '?').join(',')})`,
        args: [event.id, ...tokens],
      });
    }
    for (const a of event.sharedAccess || []) {
      stmts.push({
        sql: `INSERT INTO shared_access (token, event_id, permission, invited_by, created_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(token) DO UPDATE SET
                event_id = excluded.event_id,
                permission = excluded.permission,
                invited_by = excluded.invited_by,
                created_at = excluded.created_at`,
        args: [a.token, event.id, a.permission, a.invitedBy, a.createdAt],
      });
    }

    await this.batch(stmts);
  }

  private async load(): Promise<void> {
    try {
      this.players.clear();
      this.events.clear();
      this.eventRegistrations.clear();

      const playerRows = await this.client.execute('SELECT id, name, nick_name, owner_id, dupr_id FROM players');
      for (const row of playerRows.rows as any[]) {
        const player = new Player(row.name as string, row.id as string);
        player.ownerId = row.owner_id ?? undefined;
        if (row.dupr_id) player.duprId = row.dupr_id as string;
        this.players.set(player.id, player);
      }

      const eventRows = await this.client.execute(
        'SELECT id, name, courts, totalGamesToPlay, startedAt, endedAt, owner_id FROM events'
      );
      const regRows = await this.client.execute(
        'SELECT eventId, playerId, gamesPlayedCount, status, targetGames, partners, priority, nick_name FROM registrations'
      );
      const gameRows = await this.client.execute(
        `SELECT id, eventId, gameNumber, courtId, players, scores, createdAt,
                completed, started, startedAt, completedAt, in_history FROM games`
      );
      const shareRows = await this.client.execute(
        'SELECT token, event_id, permission, invited_by, created_at FROM shared_access'
      );

      const regsByEvent = new Map<string, EventPlayerRegistration[]>();
      for (const row of regRows.rows as any[]) {
        const partners = typeof row.partners === 'string' ? JSON.parse(row.partners) : (row.partners || []);
        const reg: EventPlayerRegistration = {
          eventId: row.eventId,
          playerId: row.playerId,
          gamesPlayedCount: Number(row.gamesPlayedCount) || 0,
          status: row.status,
          targetGames: Number(row.targetGames) || 0,
          partners,
          priority: row.priority != null ? Number(row.priority) : 10,
          nickName: row.nick_name || undefined,
        };
        const list = regsByEvent.get(reg.eventId) || [];
        list.push(reg);
        regsByEvent.set(reg.eventId, list);
        this.eventRegistrations.set(`${reg.eventId}_${reg.playerId}`, reg);
      }

      const gamesByEvent = new Map<string, { active: Game[]; history: Game[] }>();
      for (const row of gameRows.rows as any[]) {
        const playersRaw = typeof row.players === 'string' ? JSON.parse(row.players) : row.players;
        const allotmentWarning =
          typeof playersRaw?.allotmentWarning === 'string' ? playersRaw.allotmentWarning : undefined;
        const players = {
          team1: playersRaw?.team1 || [],
          team2: playersRaw?.team2 || [],
        };
        const scores = row.scores == null
          ? undefined
          : (typeof row.scores === 'string' ? JSON.parse(row.scores) : row.scores);
        const game: Game = {
          id: row.id,
          eventId: row.eventId,
          gameNumber: Number(row.gameNumber) || 0,
          courtId: Number(row.courtId),
          players,
          scores,
          createdAt: new Date(row.createdAt),
          completed: Boolean(row.completed),
          started: Boolean(row.started),
          startedAt: row.startedAt ? new Date(row.startedAt) : undefined,
          completedAt: row.completedAt ? new Date(row.completedAt) : undefined,
          ...(allotmentWarning ? { allotmentWarning } : {}),
        };
        const bucket = gamesByEvent.get(game.eventId) || { active: [], history: [] };
        if (row.in_history) bucket.history.push(game);
        else bucket.active.push(game);
        gamesByEvent.set(game.eventId, bucket);
      }

      const sharesByEvent = new Map<string, ShareAccess[]>();
      for (const row of shareRows.rows as any[]) {
        const access: ShareAccess = {
          token: row.token,
          permission: row.permission,
          invitedBy: row.invited_by,
          createdAt: row.created_at,
        };
        const list = sharesByEvent.get(row.event_id) || [];
        list.push(access);
        sharesByEvent.set(row.event_id, list);
      }

      for (const row of eventRows.rows as any[]) {
        const event = new Event(row.name, Number(row.totalGamesToPlay), Number(row.courts));
        event.id = row.id;
        event.startedAt = row.startedAt ? new Date(row.startedAt) : undefined;
        event.endedAt = row.endedAt ? new Date(row.endedAt) : undefined;
        (event as any).ownerId = row.owner_id || '';
        event.sharedAccess = sharesByEvent.get(event.id) || [];

        const regs = regsByEvent.get(event.id) || [];
        for (const r of regs) {
          event.registrations.set(r.playerId, r);
          const player = this.players.get(r.playerId);
          if (player) event.players.set(player.id, player);
        }

        const games = gamesByEvent.get(event.id) || { active: [], history: [] };
        event.games = games.active;
        event.gameHistory = games.history;

        const allGameNumbers = [...event.games, ...event.gameHistory]
          .map(g => g.gameNumber)
          .filter((n): n is number => typeof n === 'number');
        event.nextGameNumber = allGameNumbers.length > 0 ? Math.max(...allGameNumbers) + 1 : 1;

        this.events.set(event.id, event);
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
    return Array.from(this.players.values()).filter(p => p.ownerId === ownerId);
  }

  private assertUniquePlayerIdentity(
    ownerId: string,
    name: string,
    duprId: string | undefined,
    excludePlayerId?: string
  ): void {
    const nameKey = name.trim().toLowerCase();
    const duprKey = duprId ? duprId.trim().toLowerCase() : '';

    for (const p of this.players.values()) {
      if (p.ownerId !== ownerId) continue;
      if (excludePlayerId && p.id === excludePlayerId) continue;

      if (p.name.trim().toLowerCase() === nameKey) {
        throw new Error(`Player "${name.trim()}" already exists`);
      }
      if (duprKey && p.duprId && p.duprId.trim().toLowerCase() === duprKey) {
        throw new Error(`DUPR ID "${duprId!.trim()}" already exists`);
      }
    }
  }

  async createPlayer(name: string, ownerId: string, duprId?: string): Promise<Player> {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error('Player name cannot be empty');
    const trimmedDuprId = duprId?.trim() || undefined;
    this.assertUniquePlayerIdentity(ownerId, trimmedName, trimmedDuprId);

    const player = new Player(trimmedName);
    player.ownerId = ownerId;
    if (trimmedDuprId) player.duprId = trimmedDuprId;
    this.players.set(player.id, player);
    await this.savePlayer(player);
    return player;
  }

  async updatePlayer(
    playerId: string,
    updates: { name?: string; duprId?: string | null }
  ): Promise<Player | undefined> {
    const player = this.players.get(playerId);
    if (!player) return undefined;

    const nextName =
      updates.name !== undefined ? updates.name.trim() : player.name;
    if (!nextName) throw new Error('Player name cannot be empty');

    let nextDuprId: string | undefined = player.duprId;
    if (updates.duprId !== undefined) {
      const trimmed = updates.duprId == null ? '' : String(updates.duprId).trim();
      nextDuprId = trimmed || undefined;
    }

    this.assertUniquePlayerIdentity(player.ownerId || '', nextName, nextDuprId, playerId);

    player.name = nextName;
    player.duprId = nextDuprId;

    await this.savePlayer(player);
    return player;
  }

  findPlayerByName(name: string): Player | undefined {
    const key = name.trim().toLowerCase();
    return Array.from(this.players.values()).find(
      p => p.name.trim().toLowerCase() === key
    );
  }

  findPlayerByDuprId(duprId: string, ownerId?: string): Player | undefined {
    const key = duprId.trim().toLowerCase();
    if (!key) return undefined;
    return Array.from(this.players.values()).find(p => {
      if (ownerId && p.ownerId !== ownerId) return false;
      return !!p.duprId && p.duprId.trim().toLowerCase() === key;
    });
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
    event.sharedAccess = [];
    this.events.set(event.id, event);
    await this.client.execute(
      'INSERT INTO events (id, name, courts, totalGamesToPlay, startedAt, endedAt, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [event.id, event.name, event.courts, event.totalGamesToPlay, null, null, ownerId]
    );
    return event;
  }

  /**
   * Create an unstarted copy of an event that imports only registered players
   * (no games, history, start/end state, or share links).
   */
  async copyEvent(sourceEventId: string, name: string, ownerId: string): Promise<Event> {
    const source = this.events.get(sourceEventId);
    if (!source) throw new Error('Event not found');

    const event = await this.createEvent(name, source.totalGamesToPlay, source.courts, ownerId);
    for (const player of source.players.values()) {
      const canonical = this.players.get(player.id) || player;
      event.addPlayer(canonical);
    }
    await this.persistEvent(event.id);
    return event;
  }

  private pruneShareTokens(
    event: Event,
    permission: 'viewer' | 'moderator',
    keep?: ShareAccess
  ): void {
    const others = event.sharedAccess.filter(a => a.permission !== permission);
    event.sharedAccess = keep ? [...others, keep] : others;
  }

  async getOrCreateShareToken(
    eventId: string,
    permission: 'viewer' | 'moderator',
    invitedBy: string
  ): Promise<{ token: string; created: boolean }> {
    const event = this.events.get(eventId);
    if (!event) throw new Error('Event not found');

    const existing = event.sharedAccess.filter(a => a.permission === permission);
    if (existing.length > 0) {
      const keep = [...existing].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (existing.length > 1) {
        this.pruneShareTokens(event, permission, keep);
        await this.persistEvent(eventId);
      }
      return { token: keep.token, created: false };
    }

    const access: ShareAccess = {
      token: crypto.randomBytes(16).toString('hex'),
      permission,
      invitedBy,
      createdAt: new Date().toISOString(),
    };
    this.pruneShareTokens(event, permission, access);
    await this.persistEvent(eventId);
    return { token: access.token, created: true };
  }

  async refreshShareToken(
    eventId: string,
    permission: 'viewer' | 'moderator',
    invitedBy: string
  ): Promise<{ token: string }> {
    const event = this.events.get(eventId);
    if (!event) throw new Error('Event not found');

    const access: ShareAccess = {
      token: crypto.randomBytes(16).toString('hex'),
      permission,
      invitedBy,
      createdAt: new Date().toISOString(),
    };
    this.pruneShareTokens(event, permission, access);
    await this.persistEvent(eventId);
    return { token: access.token };
  }

  async generateShareToken(eventId: string, permission: 'viewer' | 'moderator', invitedBy: string): Promise<{ token: string }> {
    const result = await this.getOrCreateShareToken(eventId, permission, invitedBy);
    return { token: result.token };
  }

  resolveShareToken(token: string): { eventId: string; permission: 'viewer' | 'moderator' } | null {
    for (const event of this.events.values()) {
      const access = event.sharedAccess.find(a => a.token === token);
      if (access) {
        return { eventId: event.id, permission: access.permission };
      }
    }
    return null;
  }

  getEventsForUser(userId: string): Event[] {
    return Array.from(this.events.values()).filter((e: any) => e.ownerId === userId);
  }

  getModeratedEvents(_userId: string): Event[] {
    return [];
  }

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
      priority: 10,
    };
    this.eventRegistrations.set(key, registration);
    const event = this.events.get(eventId);
    if (event) {
      event.registrations.set(playerId, registration);
      const player = this.players.get(playerId);
      if (player) event.players.set(player.id, player);
      await this.persistEvent(eventId);
    } else {
      const stmt = this.registrationUpsertStmt(registration);
      await this.client.execute(stmt.sql, stmt.args);
    }
    return registration;
  }

  async updateEventRegistration(eventId: string, playerId: string, updates: Partial<Omit<EventPlayerRegistration, 'eventId' | 'playerId'>>): Promise<EventPlayerRegistration | undefined> {
    const key = `${eventId}_${playerId}`;
    const existing = this.eventRegistrations.get(key);
    if (!existing) return undefined;

    const updated = { ...existing, ...updates };
    this.eventRegistrations.set(key, updated);
    const event = this.events.get(eventId);
    if (event) {
      event.registrations.set(playerId, updated);
      await this.persistEvent(eventId);
    } else {
      const stmt = this.registrationUpsertStmt(updated);
      await this.client.execute(stmt.sql, stmt.args);
    }
    return updated;
  }

  getCompletedGames(eventId: string): Game[] {
    const event = this.events.get(eventId);
    return event?.gameHistory || [];
  }

  async deletePlayer(playerId: string): Promise<void> {
    const affectedEventIds: string[] = [];
    for (const event of this.events.values()) {
      if (event.players.has(playerId) || event.registrations.has(playerId)) {
        affectedEventIds.push(event.id);
        try {
          event.removePlayer(playerId);
        } catch {
          // If playing, still force-remove from maps for delete
          event.players.delete(playerId);
          event.registrations.delete(playerId);
        }
      }
    }
    this.players.delete(playerId);
    for (const key of Array.from(this.eventRegistrations.keys())) {
      if (key.endsWith(`_${playerId}`)) this.eventRegistrations.delete(key);
    }

    await this.batch([
      { sql: 'DELETE FROM registrations WHERE playerId = ?', args: [playerId] },
      { sql: 'DELETE FROM players WHERE id = ?', args: [playerId] },
    ]);

    for (const eventId of affectedEventIds) {
      await this.persistEvent(eventId);
    }
  }

  async deleteEvent(eventId: string): Promise<void> {
    this.events.delete(eventId);
    for (const key of Array.from(this.eventRegistrations.keys())) {
      if (key.startsWith(`${eventId}_`)) this.eventRegistrations.delete(key);
    }
    await this.batch([
      { sql: 'DELETE FROM shared_access WHERE event_id = ?', args: [eventId] },
      { sql: 'DELETE FROM games WHERE eventId = ?', args: [eventId] },
      { sql: 'DELETE FROM registrations WHERE eventId = ?', args: [eventId] },
      { sql: 'DELETE FROM events WHERE id = ?', args: [eventId] },
    ]);
  }

  async clear(): Promise<void> {
    this.players.clear();
    this.events.clear();
    this.eventRegistrations.clear();
    await this.batch([
      { sql: 'DELETE FROM shared_access' },
      { sql: 'DELETE FROM games' },
      { sql: 'DELETE FROM registrations' },
      { sql: 'DELETE FROM players' },
      { sql: 'DELETE FROM events' },
    ]);
  }
}
