export type PlayerStatus = 'WAITING' | 'PLAYING' | 'UNAVAILABLE' | 'AWAY' | 'RETIRED';

export interface EventPlayerRegistration {
  eventId: string;
  playerId: string;
  gamesPlayedCount: number;
  status: PlayerStatus;
  targetGames: number; // ideal number of games for this player in this event
  partners: string[]; // list of player IDs this player has partnered with in this event
}