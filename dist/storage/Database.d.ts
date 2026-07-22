import { Player } from '../models/Player';
import { Event } from '../models/Event';
import type { EventPlayerRegistration } from '../models/EventPlayerRegistration';
import type { Game } from '../models/Game';
export declare class Database {
    private static instance;
    private players;
    private events;
    private eventRegistrations;
    private client;
    private nextNickNameIndex;
    private readonly nickLetters;
    private constructor();
    static getInstance(): Database;
    private assignNickName;
    init(): Promise<void>;
    persist(): Promise<void>;
    private load;
    getPlayer(playerId: string): Player | undefined;
    getAllPlayers(): Player[];
    createPlayer(name: string): Promise<Player>;
    findPlayerByName(name: string): Player | undefined;
    getEvent(eventId: string): Event | undefined;
    getAllEvents(): Event[];
    createEvent(name: string, totalGamesToPlay: number, numCourts: number): Promise<Event>;
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