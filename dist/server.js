"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const eventRoutes_1 = __importDefault(require("./routes/eventRoutes"));
const playerRoutes_1 = __importDefault(require("./routes/playerRoutes"));
const gameRoutes_1 = __importDefault(require("./routes/gameRoutes"));
const node_path_1 = __importDefault(require("node:path"));
const app = (0, express_1.default)();
const PORT = process.env.PORT || 0;
app.use(express_1.default.json());
app.use((0, cors_1.default)());
// Serve static frontend
app.use(express_1.default.static(node_path_1.default.join(process.cwd(), 'public')));
// API info endpoint
app.get('/api', (req, res) => {
    res.json({
        message: 'GameManager API is running',
        version: '1.0.0',
        endpoints: {
            events: {
                create: 'POST /events',
                list: 'GET /events',
                get: 'GET /events/:eventId',
                status: 'GET /events/:eventId/status'
            },
            players: {
                create: 'POST /players',
                get: 'GET /players/:playerId',
                register: 'POST /events/:eventId/players',
                updateStatus: 'PATCH /events/:eventId/players/:playerId'
            },
            games: {
                schedule: 'POST /events/:eventId/schedule',
                score: 'POST /events/:eventId/games/:gameId/score',
                list: 'GET /events/:eventId/games'
            }
        }
    });
});
app.use('/events', eventRoutes_1.default);
app.use('/players', playerRoutes_1.default);
app.use('/events', playerRoutes_1.default);
app.use('/events', gameRoutes_1.default);
// Serve app shell for SPA routes
app.get('*', (req, res) => {
    res.sendFile(node_path_1.default.join(process.cwd(), 'public', 'index.html'));
});
exports.default = app;
//# sourceMappingURL=server.js.map