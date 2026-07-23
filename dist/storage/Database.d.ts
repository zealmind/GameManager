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
    private nextNickNameIndex;
    private readonly nickLetters;
    private constructor();
    static getInstance(): Database;
    private assignNickName;
    init(): Promise<void>;
    private migrateAddOwnerId;
    persist(): Promise<void>;
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
    createPlayer(name: string, ownerId: string): Promise<Player>;
    findPlayerByName(name: string): Player | undefined;
    getEvent(eventId: string): Event | undefined;
    getAllEvents(): Event[];
    getEventsByOwner(ownerId: string): Event[];
    createEvent(name: string, totalGamesToPlay: number, numCourts: number, ownerId: string): Promise<Event>;
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