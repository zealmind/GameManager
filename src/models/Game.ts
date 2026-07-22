import { randomUUID } from 'node:crypto';

export interface Game {
  id: string; // UUID
  eventId: string; // UUID
  courtId: number;
  players: {
    team1: [string, string]; // player IDs
    team2: [string, string]; // player IDs
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
  players: [string, string, string, string]
): Game {
  return {
    id: randomUUID(),
    eventId,
    courtId,
    players: {
      team1: [players[0], players[1]],
      team2: [players[2], players[3]],
    },
    scores: undefined,
    createdAt: new Date(),
    completed: false,
    started: false,
  };
}