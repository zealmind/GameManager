"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Player = void 0;
const node_crypto_1 = require("node:crypto");
class Player {
    id;
    name;
    nickName;
    constructor(name, id, nickName) {
        this.id = id || (0, node_crypto_1.randomUUID)();
        this.name = name;
        this.nickName = nickName || '';
    }
}
exports.Player = Player;
//# sourceMappingURL=Player.js.map