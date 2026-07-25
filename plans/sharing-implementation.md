# Event Sharing & Moderator Invite Implementation Plan

## Overview
Add share links (view-only) and moderator invites to events. Shared/moderated events bypass login on the welcome page and open directly to the event. Dashboard shows shared events as non-deletable.

## Backend Changes

### 1. Model & Storage
- Add `EventAccess` interface with `{ token, permission: 'viewer'|'moderator', invitedBy, createdAt }`
- Add `sharedAccess: EventAccess[]` to `SerializedEvent` and `Event`
- `Database` gets:
  - `generateShareToken(eventId, permission, userId)` - creates hex token, stores in event.sharedAccess
  - `resolveShareToken(token)` - returns `{ eventId, permission }` or undefined
  - `getEventsForUser(userId)` - returns owned events + events where user has moderator access

### 2. Routes (`src/routes/eventRoutes.ts`)
- `POST /:eventId/share` - owner creates viewer token
- `POST /:eventId/invite-moderator` - owner creates moderator token
- Add optional `X-Share-Token` header auth for GET endpoints
- Modify `GET /events/:eventId` and `GET /events/:eventId/status` to accept JWT or share token
- Add `GET /events/shared` - returns events accessible to current user (owned + moderated)
- Prevent deletion of events that have shared access (moderator-invited)

### 3. Auth Helper (`src/middleware/auth.ts`)
- Add `extractShareToken(req)` to validate `X-Share-Token` header
- Returns `{ eventId, permission }` or null

### 4. Server Route Registration (`src/server.ts`)
- Register new share/general routes

## Frontend Changes

### 1. State & Routing (`public/app.js`)
- Add global: `let accessMode = null; let accessToken = null;` (values: null, 'viewer', 'moderator')
- Parse URL query params `?share=` and `?moderate=` on init
- Welcome page:
  - If share/moderate token in URL or sessionStorage → skip auth check, show "Enter Site"
  - On enter: store token/mode in sessionStorage, navigate directly to event
- Dashboard (`renderDashboard`, `loadEventsList`):
  - API: call `/events` (owned) + `/events/shared` (shared access)
  - Merge lists, mark shared events with badge, disable delete
- Event detail (`openEventDetail`, `loadEventDetail`, `bindEventDetailActions`, `renderRegistrationPhase`, `renderGamePhase`):
  - Accept `token` and `mode` parameters
  - Render share/moderate buttons for owner at top of event page
  - For viewer mode: render same UI but pass `data-readonly` to disable all interactive elements
  - For moderator mode: full controls, but hide share/invite-moderator buttons
  - API requests include `X-Share-Token` header when in shared mode
- New functions:
  - `copyShareLink(eventId, mode)` - copies link to clipboard
  - `isSharedEvent(event)` - checks if event is in shared list

### 2. HTML (`public/index.html`)
- Add share/moderate section in event detail header area

### 3. CSS (`public/styles.css`)
- Add `.view-only` styles for disabled interactions
- Add `.shared-badge` for dashboard shared events
- Style for share link display in event header

## User Flow

### Share (Viewer)
1. Owner clicks "Share" on event page → generates token, shows link
2. Recipient opens link → welcome page shows "Enter Site" (no login)
3. Clicking enter opens event in view-only mode (all sections visible, all buttons disabled)
4. Dashboard: if they have an account, event appears as "Shared" (not deletable)

### Moderator Invite
1. Owner clicks "Invite Moderator" → generates token, shows link
2. Recipient opens link → welcome page shows "Enter Site" (no login)
3. Clicking enter opens event for management (can manage event)
4. Cannot share or invite another moderator
5. Dashboard: event appears as "Shared" (not deletable)
