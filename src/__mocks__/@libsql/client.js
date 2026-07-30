class MockClient {
  constructor() {
    this.data = {
      players: [],
      events: [],
      registrations: [],
      games: [],
      shared_access: [],
      users: [],
    };
  }

  executeMultiple() {
    return Promise.resolve();
  }

  async batch(stmts) {
    for (const s of stmts) {
      await this.execute(s.sql, s.args || []);
    }
    return [];
  }

  execute(sql, args = []) {
    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith('CREATE TABLE') || trimmed.startsWith('ALTER TABLE')) {
      return Promise.resolve({ rows: [], rowsAffected: 0, lastInsertRowid: 0, columns: [] });
    }
    if (trimmed.startsWith('DELETE')) {
      this._delete(sql, args);
      return Promise.resolve({ rows: [], rowsAffected: 0, lastInsertRowid: 0, columns: [] });
    }
    if (trimmed.startsWith('INSERT')) {
      this._upsert(sql, args);
      return Promise.resolve({ rows: [], rowsAffected: 1, lastInsertRowid: 0, columns: [] });
    }
    if (trimmed.startsWith('SELECT')) {
      return Promise.resolve({
        rows: this._select(sql, args),
        rowsAffected: 0,
        lastInsertRowid: 0,
        columns: [],
      });
    }
    if (trimmed.startsWith('UPDATE')) {
      return Promise.resolve({ rows: [], rowsAffected: 1, lastInsertRowid: 0, columns: [] });
    }
    return Promise.resolve({ rows: [], rowsAffected: 0, lastInsertRowid: 0, columns: [] });
  }

  _delete(sql, args) {
    if (sql.includes('FROM shared_access')) {
      if (!args.length) this.data.shared_access = [];
      else if (sql.includes('token NOT IN')) {
        const keep = new Set(args.slice(1));
        this.data.shared_access = this.data.shared_access.filter(
          r => r.event_id !== args[0] || keep.has(r.token)
        );
      } else if (sql.includes('event_id')) {
        this.data.shared_access = this.data.shared_access.filter(r => r.event_id !== args[0]);
      } else {
        this.data.shared_access = [];
      }
    } else if (sql.includes('FROM games')) {
      if (!args.length) this.data.games = [];
      else if (sql.includes('id NOT IN')) {
        const keep = new Set(args.slice(1));
        this.data.games = this.data.games.filter(r => r.eventId !== args[0] || keep.has(r.id));
      } else if (sql.includes('eventId')) {
        this.data.games = this.data.games.filter(r => r.eventId !== args[0]);
      } else {
        this.data.games = [];
      }
    } else if (sql.includes('FROM registrations')) {
      if (!args.length) this.data.registrations = [];
      else if (sql.includes('playerId NOT IN')) {
        const keep = new Set(args.slice(1));
        this.data.registrations = this.data.registrations.filter(
          r => r.eventId !== args[0] || keep.has(r.playerId)
        );
      } else if (sql.includes('playerId')) {
        this.data.registrations = this.data.registrations.filter(r => r.playerId !== args[0]);
      } else if (sql.includes('eventId')) {
        this.data.registrations = this.data.registrations.filter(r => r.eventId !== args[0]);
      } else {
        this.data.registrations = [];
      }
    } else if (sql.includes('FROM players')) {
      if (!args.length) this.data.players = [];
      else this.data.players = this.data.players.filter(r => r.id !== args[0]);
    } else if (sql.includes('FROM events')) {
      if (!args.length) this.data.events = [];
      else this.data.events = this.data.events.filter(r => r.id !== args[0]);
    }
  }

  _upsert(sql, args) {
    if (sql.includes('shared_access')) {
      const row = {
        token: args[0],
        event_id: args[1],
        permission: args[2],
        invited_by: args[3],
        created_at: args[4],
      };
      const idx = this.data.shared_access.findIndex(i => i.token === row.token);
      if (idx >= 0) this.data.shared_access[idx] = row;
      else this.data.shared_access.push(row);
    } else if (sql.includes('INTO players')) {
      const row = { id: args[0], name: args[1], nick_name: args[2], owner_id: args[3] };
      const idx = this.data.players.findIndex(i => i.id === row.id);
      if (idx >= 0) this.data.players[idx] = row;
      else this.data.players.push(row);
    } else if (sql.includes('INTO events')) {
      const row = {
        id: args[0],
        name: args[1],
        courts: args[2],
        totalGamesToPlay: args[3],
        startedAt: args[4],
        endedAt: args[5],
        owner_id: args[6],
      };
      const idx = this.data.events.findIndex(i => i.id === row.id);
      if (idx >= 0) this.data.events[idx] = row;
      else this.data.events.push(row);
    } else if (sql.includes('INTO registrations')) {
      const row = {
        eventId: args[0],
        playerId: args[1],
        gamesPlayedCount: args[2],
        status: args[3],
        targetGames: args[4],
        partners: args[5],
        priority: args[6],
      };
      const idx = this.data.registrations.findIndex(
        i => i.eventId === row.eventId && i.playerId === row.playerId
      );
      if (idx >= 0) this.data.registrations[idx] = row;
      else this.data.registrations.push(row);
    } else if (sql.includes('INTO games')) {
      const row = {
        id: args[0],
        eventId: args[1],
        gameNumber: args[2],
        courtId: args[3],
        players: args[4],
        scores: args[5],
        createdAt: args[6],
        completed: args[7],
        started: args[8],
        startedAt: args[9],
        completedAt: args[10],
        in_history: args[11],
      };
      const idx = this.data.games.findIndex(i => i.id === row.id);
      if (idx >= 0) this.data.games[idx] = row;
      else this.data.games.push(row);
    } else if (sql.includes('INTO users')) {
      this.data.users.push({ id: args[0], email: args[1], name: args[2] });
    }
  }

  transaction() {
    return Promise.resolve({
      execute: (sql, args) => this.execute(sql, args),
      batch: (stmts) => this.batch(stmts),
      executeMultiple: () => this.executeMultiple(),
      commit: () => Promise.resolve(),
      rollback: () => Promise.resolve(),
      close: () => {},
      closed: false,
    });
  }

  close() {
    return Promise.resolve();
  }

  _select(sql, args) {
    if (sql.includes('FROM players')) return this.data.players;
    if (sql.includes('FROM events')) return this.data.events;
    if (sql.includes('FROM registrations')) return this.data.registrations;
    if (sql.includes('FROM games')) return this.data.games;
    if (sql.includes('FROM shared_access')) return this.data.shared_access;
    if (sql.includes('FROM users')) {
      if (args?.[0]) {
        return this.data.users.filter(u => u.email === args[0] || u.id === args[0]);
      }
      return this.data.users;
    }
    return [];
  }
}

function createClient() {
  return new MockClient();
}

module.exports = {
  createClient,
  MockClient,
};
