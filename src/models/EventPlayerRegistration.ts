export type PlayerStatus = 'WAITING' | 'PLAYING' | 'UNAVAILABLE' | 'AWAY' | 'RETIRED' | 'FULLFILLED';

export interface EventPlayerRegistration {
  eventId: string;
  playerId: string;
  gamesPlayedCount: number;
  status: PlayerStatus;
  targetGames: number;
  partners: string[];
  priority: number;
}