"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGame = createGame;
const node_crypto_1 = require("node:crypto");
function createGame(eventId, courtId, team1, team2) {
    return {
        id: (0, node_crypto_1.randomUUID)(),
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
//# sourceMappingURL=Game.js.map