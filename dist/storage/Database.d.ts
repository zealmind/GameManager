import { createClient } from "@libsql/client";
import { Player } from '../models/Player';
import { Event } from '../models/Event';
import type { EventPlayerRegistration } from '../models/EventPlayerRegistration';
import type { Game } from '../models/Game';
export declare class Database {
    private static instance;
    private players;
    private events;
    private eventRegistrations;
    client: ReturnType<typeof createClient>;
    private constructor();
    static getInstance(): Database;
    init(): Promise<void>;
    /** Add dupr_id to existing players tables that predate the column. */
    private migrateAddDuprId;
    /** Add nick_name to existing registrations tables (per-event, not on shared players). */
    private migrateAddRegistrationNickName;
    private syncRegistrationIndex;
    private batch;
    private playerUpsertStmt;
    private registrationUpsertStmt;
    private gameUpsertStmt;
    /** Persist a single player row. */
    savePlayer(player: Player): Promise<void>;
    /**
     * Persist one event and its related rows only (registrations, games, shares),
     * plus any players attached to the event.
     * Other events are left untouched for better concurrency.
     */
    persistEvent(eventId: string): Promise<void>;
    private load;
    createUser(email: string, name: string, provider: string, providerId?: string, avatarUrl?: string): Promise<{
        id: string;
    }>;
    getUserByEmail(email: string): Promise<{
        id: string;
        email: string;
        name: string;
        provider: string;
        password_hash?: string;
    } | undefined>;
    getUserByProvider(provider: string, providerId: string): Promise<{
        id: string;
        email: string;
        name: string;
        provider: string;
    } | undefined>;
    getUserById(id: string): Promise<{
        id: string;
        email: string;
        name: string;
        provider: string;
        avatar_url?: string;
    } | undefined>;
    updateUserPassword(userId: string, passwordHash: string): Promise<void>;
    getPlayer(playerId: string): Player | undefined;
    getAllPlayers(): Player[];
    getPlayersByOwner(ownerId: string): Player[];
    private assertUniquePlayerIdentity;
    createPlayer(name: string, ownerId: string, duprId?: string): Promise<Player>;
    updatePlayer(playerId: string, updates: {
        name?: string;
        duprId?: string | null;
    }): Promise<Player | undefined>;
    findPlayerByName(name: string): Player | undefined;
    findPlayerByDuprId(duprId: string, ownerId?: string): Player | undefined;
    getEvent(eventId: string): Event | undefined;
    getAllEvents(): Event[];
    getEventsByOwner(ownerId: string): Event[];
    createEvent(name: string, totalGamesToPlay: number, numCourts: number, ownerId: string): Promise<Event>;
    /**
     * Create an unstarted copy of an event that imports only registered players
     * (no games, history, start/end state, or share links).
     */
    copyEvent(sourceEventId: string, name: string, ownerId: string): Promise<Event>;
    private pruneShareTokens;
    getOrCreateShareToken(eventId: string, permission: 'viewer' | 'moderator', invitedBy: string): Promise<{
        token: string;
        created: boolean;
    }>;
    refreshShareToken(eventId: string, permission: 'viewer' | 'moderator', invitedBy: string): Promise<{
        token: string;
    }>;
    generateShareToken(eventId: string, permission: 'viewer' | 'moderator', invitedBy: string): Promise<{
        token: string;
    }>;
    resolveShareToken(token: string): {
        eventId: string;
        permission: 'viewer' | 'moderator';
    } | null;
    getEventsForUser(userId: string): Event[];
    getModeratedEvents(_userId: string): Event[];
    getEventRegistration(eventId: string, playerId: string): EventPlayerRegistration | undefined;
    getAllEventRegistrations(eventId: string): EventPlayerRegistration[];
    createEventRegistration(eventId: string, playerId: string, targetGames: number): Promise<EventPlayerRegistration>;
    updateEventRegistration(eventId: string, playerId: string, updates: Partial<Omit<EventPlayerRegistration, 'eventId' | 'playerId'>>): Promise<EventPlayerRegistration | undefined>;
    getCompletedGames(eventId: string): Game[];
    deletePlayer(playerId: string): Promise<void>;
    deleteEvent(eventId: string): Promise<void>;
    clear(): Promise<void>;
}
//# sourceMappingURL=Database.d.ts.map