const { EventEmitter } = require('events');

class MockClient {
  constructor() {
    this.data = {
      players: [],
      events: [],
      registrations: [],
      games: []
    };
  }

  executeMultiple(sql) {
    if (sql.includes('CREATE TABLE')) {
      return Promise.resolve();
    }
    if (sql.includes('DELETE')) {
      if (sql.includes('FROM players')) this.data.players = [];
      else if (sql.includes('FROM events')) this.data.events = [];
      else if (sql.includes('FROM registrations')) this.data.registrations = [];
      else if (sql.includes('FROM games')) this.data.games = [];
    }
    return Promise.resolve();
  }

  execute(sql, args) {
    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith('CREATE TABLE') || trimmed.startsWith('DELETE')) {
      return this.executeMultiple(sql);
    }
    if (trimmed.startsWith('INSERT')) {
      let table = 'players';
      if (sql.includes('events')) table = 'events';
      else if (sql.includes('registrations')) table = 'registrations';
      else if (sql.includes('games')) table = 'games';
      
      const row = this._buildRow(table, args);
      const idx = this.data[table].findIndex(item => item.id === row.id);
      if (idx >= 0) this.data[table][idx] = row;
      else this.data[table].push(row);
      return Promise.resolve({ rows: [], rowsAffected: 1, lastInsertRowid: 0, columns: [] });
    }
    if (trimmed.startsWith('SELECT')) {
      const rows = this._select(sql, args);
      return Promise.resolve({ rows, rowsAffected: 0, lastInsertRowid: 0, columns: [] });
    }
    return Promise.resolve({ rows: [], rowsAffected: 0, lastInsertRowid: 0, columns: [] });
  }

  batch() {
    return Promise.resolve([]);
  }

  transaction() {
    return Promise.resolve({
      execute: (sql, args) => this.execute(sql, args),
      batch: () => Promise.resolve([]),
      executeMultiple: (sql) => this.executeMultiple(sql),
      commit: () => Promise.resolve(),
      rollback: () => Promise.resolve(),
      close: () => {},
      closed: false
    });
  }

  close() {
    return Promise.resolve();
  }

  _buildRow(table, args) {
    if (table === 'players') {
      return { id: args[0], name: args[1], nickName: args[2] };
    }
    if (table === 'events') {
      return { id: args[0], name: args[1], courts: args[2], totalGamesToPlay: args[3], startedAt: args[4] };
    }
    if (table === 'registrations') {
      return {
        eventId: args[0],
        playerId: args[1],
        gamesPlayedCount: args[2],
        status: args[3],
        targetGames: args[4],
        partners: JSON.parse(args[5] || '[]')
      };
    }
    if (table === 'games') {
      return {
        id: args[0],
        eventId: args[1],
        courtId: args[2],
        players: JSON.parse(args[3] || '[]'),
        scores: args[4] ? JSON.parse(args[4]) : null,
        createdAt: args[5],
        completed: args[6],
        started: args[7],
        startedAt: args[8],
        completedAt: args[9]
      };
    }
    return {};
  }

  _select(sql, args) {
    if (sql.includes('FROM players')) {
      return this.data.players;
    }
    if (sql.includes('FROM events')) {
      return this.data.events;
    }
    if (sql.includes('FROM registrations')) {
      return this.data.registrations;
    }
    if (sql.includes('FROM games')) {
      return this.data.games;
    }
    if (sql.includes('FROM app_state')) {
      return [{ data: JSON.stringify(this.data) }];
    }
    return [];
  }
}

function createClient() {
  return new MockClient();
}

module.exports = {
  createClient,
  MockClient
};
