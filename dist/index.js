"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = __importDefault(require("./server"));
const Database_1 = require("./storage/Database");
(async () => {
    const db = Database_1.Database.getInstance();
    await db.init();
    const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4444;
    const server = server_1.default.listen(PORT, () => {
        const actualPort = server.address()?.port ?? PORT;
        console.log(`GameManager server listening on port ${actualPort}`);
    });
})();
//# sourceMappingURL=index.js.map