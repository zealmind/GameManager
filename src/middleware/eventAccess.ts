import { Request, Response, NextFunction } from 'express';
import { Database } from '../storage/Database';
import { authenticate, extractShareToken, ShareAccess } from './auth';

export async function withEventAccess(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : (req as any).cookies?.token;

  // Always resolve a share token if present, regardless of whether the user is logged in.
  // This allows a logged-in user who also holds a share token to access events they don't own.
  const share = req.headers['x-share-token'];
  if (typeof share === 'string') {
    const access = Database.getInstance().resolveShareToken(share);
    if (access) {
      (req as any).shareAccess = access;
    }
  }

  if (token) {
    return authenticate(req, res, next);
  }

  if ((req as any).shareAccess) {
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized' });
}

export function requireOwnerOrModerator(req: any, res: Response, next: NextFunction) {
  const event = req.event;
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const user = req.user;
  const shareAccess = req.shareAccess as ShareAccess | undefined;

  if (user && (event as any).ownerId === user.id) {
    return next();
  }

  if (shareAccess && shareAccess.eventId === event.id && shareAccess.permission === 'moderator') {
    return next();
  }

  return res.status(403).json({ error: 'Forbidden' });
}

export function loadEvent(req: any, res: Response, next: NextFunction) {
  const event = Database.getInstance().getEvent(req.params.eventId as string);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }
  req.event = event;
  next();
}
