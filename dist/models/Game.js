"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGame = createGame;
const node_crypto_1 = require("node:crypto");
function createGame(eventId, courtId, players) {
    return {
        id: (0, node_crypto_1.randomUUID)(),
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
//# sourceMappingURL=Game.js.map