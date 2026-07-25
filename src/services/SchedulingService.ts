import { Database } from '../storage/Database';
import { Event } from '../models/Event';
import { Game, createGame } from '../models/Game';

export interface ScheduleResult {
  success: boolean;
  game?: Game;
  reason?: string;
  blockingConstraints?: string[];
  shouldWait?: boolean;
}

export class SchedulingService {
  private db: Database;

  constructor() {
    this.db = Database.getInstance();
  }

  getAvailablePlayers(event: Event) {
    const allPlayers = Array.from(event.players.values());
    return allPlayers
      .filter(p => {
        const reg = event.getRegistration(p.id);
        return reg && reg.status === 'WAITING';
      })
      .map(p => {
        const reg = event.getRegistration(p.id)!;
        const avg = event.getAverageGamesPlayed();
        const deficit = avg - reg.gamesPlayedCount;
        return { player: p, deficit, gamesPlayedCount: reg.gamesPlayedCount };
      })
      .sort((a, b) => {
        const diff = a.deficit - b.deficit;
        if (Math.abs(diff) > 0.001) return diff;
        return a.player.id.localeCompare(b.player.id);
      })
      .map(item => item.player);
  }

  hasPlayedTogether(player1Id: string, player2Id: string, event: Event): boolean {
    const reg1 = event.getRegistration(player1Id);
    return reg1 ? reg1.partners.includes(player2Id) : false;
  }

  assignNextGame(eventId: string, courtId: number): ScheduleResult {
    const event = this.db.getEvent(eventId);
    if (!event) {
      return { success: false, reason: 'Event not found', blockingConstraints: ['Event does not exist'] };
    }
    if (event.isComplete()) {
      return { success: false, reason: 'Event has been ended', blockingConstraints: ['No more games can be scheduled'] };
    }
    if (courtId < 1 || courtId > event.courts) {
      return { success: false, reason: 'Invalid court number', blockingConstraints: [`Court ${courtId} does not exist`] };
    }
    const alreadyActive = event.games.find(g => !g.completed && g.courtId === courtId);
    if (alreadyActive) {
      if (alreadyActive.started) {
        return { success: false, reason: `Court ${courtId} game has already started`, blockingConstraints: [`Court ${courtId} is currently in play`] };
      }
      const previousIds = new Set([...alreadyActive.players.team1, ...alreadyActive.players.team2]);
      for (const pid of previousIds) {
        const reg = event.getRegistration(pid);
        if (reg) reg.status = 'WAITING';
      }
      event.games = event.games.filter(g => !(!g.completed && g.courtId === courtId));
    }

    let available = this.getAvailablePlayers(event);
    if (alreadyActive && available.length > 4) {
      const others = available.filter(p => !new Set([...alreadyActive.players.team1, ...alreadyActive.players.team2]).has(p.id));
      if (others.length >= 4) {
        available = others;
      }
    }

    if (available.length < 3) {
      return { success: false, reason: 'No players available to play next game yet or unable to do pairing among waiting players', blockingConstraints: ['Insufficient available players'], shouldWait: true };
    }

    const maxAttempts = Math.min(available.length, 30);

    // Try 2v2 first when 4+ players are available
    if (available.length >= 4) {
      for (let i = 0; i < maxAttempts; i++) {
        const topPlayer = available[i];
        const remaining = available.filter(p => p.id !== topPlayer.id);
        const partner = remaining.find(p => !this.hasPlayedTogether(topPlayer.id, p.id, event));
        if (!partner) continue;

        const team1 = [topPlayer, partner];
        const team1Ids = new Set([topPlayer.id, partner.id]);
        const opponentsCandidates = remaining.filter(p => !team1Ids.has(p.id));
        let team2: any[] = [];
        outer: for (let j = 0; j < opponentsCandidates.length - 1; j++) {
          for (let k = j + 1; k < opponentsCandidates.length; k++) {
            if (!this.hasPlayedTogether(opponentsCandidates[j].id, opponentsCandidates[k].id, event)) {
              team2 = [opponentsCandidates[j], opponentsCandidates[k]];
              break outer;
            }
          }
        }
        if (team2.length < 2) continue;

        const playerIds = [team1[0].id, team1[1].id, team2[0].id, team2[1].id];
        const game = createGame(eventId, courtId, [team1[0].id, team1[1].id], [team2[0].id, team2[1].id]);
        game.gameNumber = event.nextGameNumber++;

        const allPlayers = [...team1, ...team2];
        for (const p of allPlayers) {
          event.updateRegistration(p.id, { status: 'PLAYING' });
        }

        event.games.push(game);
        return { success: true, game };
      }
    }

    // Fallback: form 1v2 games when 3+ players are available but 2v2 pairing failed
    for (let i = 0; i < maxAttempts; i++) {
      const topPlayer = available[i];
      const remaining = available.filter(p => p.id !== topPlayer.id);

      if (remaining.length >= 2) {
        const team1 = [topPlayer];
        const team2 = [remaining[0], remaining[1]];
        if (!this.hasPlayedTogether(remaining[0].id, remaining[1].id, event)) {
          const game = createGame(eventId, courtId, [topPlayer.id], [remaining[0].id, remaining[1].id]);
          game.gameNumber = event.nextGameNumber++;

          for (const p of [...team1, ...team2]) {
            event.updateRegistration(p.id, { status: 'PLAYING' });
          }

          event.games.push(game);
          return { success: true, game };
        }
      }
    }

    return { success: false, reason: 'No players available to play next game yet or unable to do pairing among waiting players', blockingConstraints: ['Try releasing some players from AWAY/RETIRED'], shouldWait: true };
  }

  completePartialGame(eventId: string, courtId: number, team1: string[], team2: string[]): ScheduleResult {
    const event = this.db.getEvent(eventId);
    if (!event) {
      return { success: false, reason: 'Event not found', blockingConstraints: ['Event does not exist'] };
    }
    if (event.isComplete()) {
      return { success: false, reason: 'Event has been ended', blockingConstraints: ['No more games can be scheduled'] };
    }
    if (courtId < 1 || courtId > event.courts) {
      return { success: false, reason: 'Invalid court number', blockingConstraints: [`Court ${courtId} does not exist`] };
    }

    const alreadyActive = event.games.find(g => !g.completed && g.courtId === courtId);
    if (alreadyActive) {
      if (alreadyActive.started) {
        return { success: false, reason: `Court ${courtId} game has already started`, blockingConstraints: [`Court ${courtId} is currently in play`] };
      }
      const previousIds = new Set([...alreadyActive.players.team1, ...alreadyActive.players.team2]);
      for (const pid of previousIds) {
        const reg = event.getRegistration(pid);
        if (reg) reg.status = 'WAITING';
      }
      event.games = event.games.filter(g => !(!g.completed && g.courtId === courtId));
    }

    const selectedIds = new Set([...team1, ...team2]);
    if (selectedIds.size !== team1.length + team2.length) {
      return { success: false, reason: 'Duplicate players in selection', blockingConstraints: ['Players must be distinct'] };
    }

    for (const pid of selectedIds) {
      const reg = event.getRegistration(pid);
      if (!reg) {
        return { success: false, reason: `Player ${pid} is not registered for this event`, blockingConstraints: ['Invalid player'] };
      }
      if (reg.status !== 'WAITING') {
        return { success: false, reason: `Player is not available`, blockingConstraints: ['Player not WAITING'] };
      }
    }

    const totalSelected = team1.length + team2.length;
    if (totalSelected >= 4) {
      const game = createGame(eventId, courtId, team1, team2);
      game.gameNumber = event.nextGameNumber++;
      for (const pid of selectedIds) {
        event.updateRegistration(pid, { status: 'PLAYING' });
      }
      event.games.push(game);
      return { success: true, game };
    }

    const remainingNeeded = 4 - totalSelected;
    let available = this.getAvailablePlayers(event).filter(p => !selectedIds.has(p.id));

    if (available.length < remainingNeeded) {
      return { success: false, reason: 'Not enough available players to complete the game', blockingConstraints: ['Insufficient available players'], shouldWait: true };
    }

    const maxAttempts = Math.min(available.length, 30);

    // Try 2v2 completion
    for (let i = 0; i < maxAttempts; i++) {
      const candidates = available.filter(p => p.id !== available[i].id);
      const partner = candidates.find(p => !this.hasPlayedTogether(available[i].id, p.id, event));
      if (!partner) continue;

      const partnerId = partner.id;
      const candidateIds = new Set(candidates.map(c => c.id).filter(id => id !== partnerId));
      let opponentPair: string[] = [];
      const candidateArray = candidates.filter(c => c.id !== partnerId);
      outer: for (let j = 0; j < candidateArray.length - 1; j++) {
        for (let k = j + 1; k < candidateArray.length; k++) {
          if (!this.hasPlayedTogether(candidateArray[j].id, candidateArray[k].id, event)) {
            opponentPair = [candidateArray[j].id, candidateArray[k].id];
            break outer;
          }
        }
      }
      if (opponentPair.length < 2) continue;

      const finalTeam1 = [...team1];
      const finalTeam2 = [...team2];
      const usedInFill = new Set([...opponentPair, partnerId]);

      // Distribute filled players: try to balance teams
      const t1Count = finalTeam1.length;
      const t2Count = finalTeam2.length;

      if (t1Count === 0 && t2Count === 0) {
        finalTeam1.push(available[i].id, partnerId);
        finalTeam2.push(...opponentPair);
      } else if (t1Count === 1 && t2Count === 0) {
        finalTeam1.push(partnerId);
        finalTeam2.push(...opponentPair);
      } else if (t1Count === 0 && t2Count === 1) {
        finalTeam2.push(partnerId);
        finalTeam1.push(...opponentPair);
      } else if (t1Count === 1 && t2Count === 1) {
        finalTeam1.push(partnerId);
        finalTeam2.push(...opponentPair);
      } else if (t1Count === 2 && t2Count === 0) {
        finalTeam2.push(...opponentPair);
      } else if (t1Count === 0 && t2Count === 2) {
        finalTeam1.push(...opponentPair);
      } else if (t1Count === 1 && t2Count === 2) {
        finalTeam1.push(partnerId);
      } else if (t1Count === 2 && t2Count === 1) {
        finalTeam2.push(partnerId);
      }

      const game = createGame(eventId, courtId, finalTeam1, finalTeam2);
      game.gameNumber = event.nextGameNumber++;
      for (const pid of [...finalTeam1, ...finalTeam2]) {
        event.updateRegistration(pid, { status: 'PLAYING' });
      }
      event.games.push(game);
      return { success: true, game };
    }

    // Fallback: 1v2 completion
    for (let i = 0; i < maxAttempts; i++) {
      const topPlayer = available[i];
      const remaining = available.filter(p => p.id !== topPlayer.id);

      if (remaining.length >= 2) {
        const finalTeam1 = [...team1];
        const finalTeam2 = [...team2];

        if (!this.hasPlayedTogether(remaining[0].id, remaining[1].id, event)) {
          if (finalTeam1.length === 0 && finalTeam2.length === 0) {
            finalTeam1.push(topPlayer.id);
            finalTeam2.push(remaining[0].id, remaining[1].id);
          } else if (finalTeam1.length === 1 && finalTeam2.length === 0) {
            finalTeam2.push(topPlayer.id, remaining[0].id, remaining[1].id);
          } else if (finalTeam1.length === 0 && finalTeam2.length === 1) {
            finalTeam1.push(topPlayer.id, remaining[0].id, remaining[1].id);
          } else if (finalTeam1.length === 1 && finalTeam2.length === 1) {
            finalTeam2.push(topPlayer.id, remaining[0].id, remaining[1].id);
          } else {
            continue;
          }

          const game = createGame(eventId, courtId, finalTeam1, finalTeam2);
          game.gameNumber = event.nextGameNumber++;
          for (const pid of [...finalTeam1, ...finalTeam2]) {
            event.updateRegistration(pid, { status: 'PLAYING' });
          }
          event.games.push(game);
          return { success: true, game };
        }
      }
    }

    return { success: false, reason: 'No players available to play next game yet or unable to do pairing among waiting players', blockingConstraints: ['Try releasing some players from AWAY/RETIRED'], shouldWait: true };
  }

  startGame(eventId: string, gameId: string): ScheduleResult {
    const event = this.db.getEvent(eventId);
    if (!event) return { success: false, reason: 'Event not found' };
    const game = event.games.find(g => g.id === gameId);
    if (!game) return { success: false, reason: 'Game not found' };
    if (game.completed) return { success: false, reason: 'Game already completed' };
    game.started = true;
    game.startedAt = new Date();
    return { success: true, game };
  }

  endGame(eventId: string, gameId: string, scores?: { score_team1?: number; score_team2?: number }): ScheduleResult {
    const event = this.db.getEvent(eventId);
    if (!event) return { success: false, reason: 'Event not found' };
    const game = event.games.find(g => g.id === gameId);
    if (!game) return { success: false, reason: 'Game not found' };
    if (game.completed) return { success: false, reason: 'Game already completed' };
    if (!game.started) return { success: false, reason: 'Game has not started yet' };

    if (scores?.score_team1 !== undefined && scores?.score_team2 !== undefined) {
      game.scores = [scores.score_team1, scores.score_team2];
    }
    if (game.scores === undefined) {
      return { success: false, reason: 'Scores have not been provided yet', blockingConstraints: ['Score is required'] };
    }

    const [team1, team2] = game.scores;
    if ((team1 < 11 && team2 < 11) || Math.abs(team1 - team2) < 2) {
      return { success: false, reason: 'Invalid score: one team must reach at least 11 and win by 2', blockingConstraints: ['Score validation failed'] };
    }

    game.completed = true;
    game.completedAt = new Date();

    event.gameHistory.push({ ...game, players: { ...game.players, team1: [...game.players.team1], team2: [...game.players.team2] } });

    const allPlayerIds = [...game.players.team1, ...game.players.team2];
    const team1Ids = new Set(game.players.team1);
    for (const playerId of allPlayerIds) {
      const reg = event.getRegistration(playerId);
      if (reg) {
        reg.gamesPlayedCount++;
        if (reg.gamesPlayedCount >= reg.targetGames) {
          reg.status = 'AWAY';
        } else {
          reg.status = 'WAITING';
        }
        const teammate = allPlayerIds.find(pid => pid !== playerId && team1Ids.has(pid) === team1Ids.has(playerId));
        if (teammate && !reg.partners.includes(teammate)) {
          reg.partners.push(teammate);
        }
      }
    }

    return { success: true, game };
  }
}
