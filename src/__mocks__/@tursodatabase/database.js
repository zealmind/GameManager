const { EventEmitter } = require('events');

class MockStatement {
  constructor() {
    this._rows = [];
    this._columns = [];
  }

  all() {
    return Promise.resolve(this._rows);
  }

  get() {
    return Promise.resolve(this._rows[0] || null);
  }

  run() {
    return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
  }

  exec() {
    return Promise.resolve();
  }

  raw() {
    return this;
  }

  pluck() {
    return this;
  }

  safeIntegers() {
    return this;
  }

  columns() {
    return this._columns;
  }

  withRows(rows) {
    this._rows = rows;
    return this;
  }

  withColumns(columns) {
    this._columns = columns;
    return this;
  }

  iterate() {
    let index = 0;
    const rows = this._rows;
    const iterNext = function() {
      if (index >= rows.length) {
        return Promise.resolve({ done: true });
      }
      return Promise.resolve({ value: rows[index++], done: false });
    };
    const gen = {
      next: function() {
        return iterNext();
      }
    };
    return gen;
  }
}

class MockDatabase extends EventEmitter {
  constructor() {
    super();
    this.data = {
      players: [],
      events: [],
      registrations: [],
      games: []
    };
  }

  prepare(sql) {
    return this._createStatement(sql);
  }

  run(sql, ...args) {
    return Promise.resolve({ changes: 0, lastInsertRowid: 0 });
  }

  get(sql, ...args) {
    const stmt = new MockStatement();
    return Promise.resolve(null);
  }

  all(sql, ...args) {
    return Promise.resolve(this._executeSelect(sql));
  }

  exec(sql) {
    if (sql.includes('CREATE TABLE')) {
      return Promise.resolve();
    }
    if (sql.includes('DELETE')) {
      if (sql.includes('FROM players')) {
        this.data.players = [];
      } else if (sql.includes('FROM events')) {
        this.data.events = [];
      } else if (sql.includes('FROM registrations')) {
        this.data.registrations = [];
      } else if (sql.includes('FROM games')) {
        this.data.games = [];
      }
    }
    return Promise.resolve();
  }

  batch() {
    return Promise.resolve([]);
  }

  transaction() {
    return Promise.resolve({
      execute: function() { return Promise.resolve(); },
      batch: function() { return Promise.resolve([]); },
      executeMultiple: function() { return Promise.resolve(); },
      commit: function() { return Promise.resolve(); },
      rollback: function() { return Promise.resolve(); },
      close: function() {},
      closed: false
    });
  }

  close() {
    return Promise.resolve();
  }

  get inTransaction() {
    return false;
  }

  _createStatement(sql) {
    return Promise.resolve(new MockStatement());
  }

  _executeSelect(sql) {
    if (sql.includes('FROM players')) {
      return this.data.players;
    } else if (sql.includes('FROM events')) {
      return this.data.events;
    } else if (sql.includes('FROM registrations')) {
      return this.data.registrations;
    } else if (sql.includes('FROM games')) {
      return this.data.games;
    } else if (sql.includes('FROM app_state')) {
      return [{ data: JSON.stringify(this.data) }];
    }
    return [];
  }
}

module.exports = {
  connect: function() {
    return Promise.resolve(new MockDatabase());
  },
  Database: MockDatabase,
  SqliteError: class SqliteError extends Error {
    constructor(message, code) {
      super(message);
      this.code = code;
    }
  },
  Transaction: class Transaction extends EventEmitter {}
};
