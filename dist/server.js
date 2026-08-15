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
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const node_path_1 = __importDefault(require("node:path"));
const Database_1 = require("./storage/Database");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 0;
app.use(express_1.default.json());
app.use((0, cors_1.default)());
// Public token resolution
app.get('/share/:token', (req, res) => {
    try {
        const token = req.params.token;
        const db = Database_1.Database.getInstance();
        const access = db.resolveShareToken(token);
        if (!access) {
            return res.status(404).json({ error: 'Invalid or expired share link' });
        }
        res.json({ eventId: access.eventId, permission: access.permission });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Serve static frontend
app.use(express_1.default.static(node_path_1.default.join(process.cwd(), 'public')));
// Public auth routes
app.use('/auth', authRoutes_1.default);
// API info endpoint
app.get('/api', (req, res) => {
    let version = 'unknown';
    try {
        const versionData = JSON.parse(require('fs').readFileSync(node_path_1.default.join(process.cwd(), 'public', 'version.json'), 'utf8'));
        version = `${versionData.major}.${versionData.minor}.${versionData.patch}`;
    }
    catch { }
    res.json({
        message: 'GameManager API is running',
        version,
        endpoints: {
            auth: {
                register: 'POST /auth/register',
                login: 'POST /auth/login',
                me: 'GET /auth/me',
                github: 'GET /auth/github',
                google: 'GET /auth/google'
            },
            events: {
                create: 'POST /events',
                list: 'GET /events',
                get: 'GET /events/:eventId',
                rename: 'PATCH /events/:eventId',
                copy: 'POST /events/:eventId/copy',
                status: 'GET /events/:eventId/status'
            },
            players: {
                create: 'POST /players',
                get: 'GET /players/:playerId',
                update: 'PATCH /players/:playerId',
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
// Serve app shell for SPA routes (skip if it looks like an asset request)
app.get('*', (req, res) => {
    if (req.path.includes('.')) {
        return res.status(404).send('Not found');
    }
    res.sendFile(node_path_1.default.join(process.cwd(), 'public', 'index.html'));
});
exports.default = app;
//# sourceMappingURL=server.js.map