"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withEventAccess = withEventAccess;
exports.requireOwnerOrModerator = requireOwnerOrModerator;
exports.loadEvent = loadEvent;
const Database_1 = require("../storage/Database");
const auth_1 = require("./auth");
async function withEventAccess(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : req.cookies?.token;
    if (token) {
        return (0, auth_1.authenticate)(req, res, next);
    }
    const share = req.headers['x-share-token'];
    if (typeof share === 'string') {
        const access = Database_1.Database.getInstance().resolveShareToken(share);
        if (access) {
            req.shareAccess = access;
            return next();
        }
    }
    return res.status(401).json({ error: 'Unauthorized' });
}
function requireOwnerOrModerator(req, res, next) {
    const event = req.event;
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    const user = req.user;
    const shareAccess = req.shareAccess;
    if (user && event.ownerId === user.id) {
        return next();
    }
    if (shareAccess && shareAccess.eventId === event.id && shareAccess.permission === 'moderator') {
        return next();
    }
    return res.status(403).json({ error: 'Forbidden' });
}
function loadEvent(req, res, next) {
    const event = Database_1.Database.getInstance().getEvent(req.params.eventId);
    if (!event) {
        return res.status(404).json({ error: 'Event not found' });
    }
    req.event = event;
    next();
}
//# sourceMappingURL=eventAccess.js.map