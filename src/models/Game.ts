import { randomUUID } from 'node:crypto';

export interface Game {
  id: string; // UUID
  eventId: string; // UUID
  gameNumber: number;
  courtId: number;
  players: {
    team1: string[]; // player IDs
    team2: string[]; // player IDs
  };
  scores?: [number, number]; // team1 score, team2 score (undefined if not completed)
  createdAt: Date;
  completed: boolean;
  started: boolean;
  startedAt?: Date;
  completedAt?: Date;
}

export function createGame(
  eventId: string,
  courtId: number,
  team1: string[],
  team2: string[]
): Game {
  return {
    id: randomUUID(),
    eventId,
    gameNumber: 0,
    courtId,
    players: {
      team1,
      team2,
    },
    scores: undefined,
    createdAt: new Date(),
    completed: false,
    started: false,
  };
}