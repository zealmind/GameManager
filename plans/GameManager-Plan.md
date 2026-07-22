# Pickleball Event Scheduler Plan

## 1. Core Data Structures

### Event
- `id`: Unique identifier for the event.
- `name`: Unique name for the event.
- `players`: Collection of Player objects associated with this event.
- `games_played`: Count of completed games.
- `game_history`: List of completed Game objects, including scores and participants.
- `courts`: Configuration for the number of courts available.
- `event_completion_criteria`: Defined as the total number of games to be played (e.g., 18 for 12 players aiming for 6 games each) or other metrics.
- `started_at`: Timestamp when the event was started (null if not started).

### Player
- `id`: Unique identifier for the player within an event.
- `name`: Player's name (assumed unique within an event).
- `status`: 'WAITING', 'PLAYING', 'UNAVAILABLE', 'AWAY', 'RETIRED'.
- `games_played_count`: Number of games the player has participated in.
- `target_games`: The ideal number of games for this player.
- `partners`: List of players this player has been paired with.

### Game
- `id`: UUID
- `event_id`: UUID
- `court_id`: number
- `players`: { team1: [string, string], team2: [string, string] }
- `scores`: [number, number] | undefined
- `completed`: boolean
- `started`: boolean
- `started_at`: Date | undefined
- `completed_at`: Date | undefined

### EventPlayerRegistration
- `eventId`: UUID
- `playerId`: UUID
- `gamesPlayedCount`: number
- `status`: 'WAITING' | 'PLAYING' | 'UNAVAILABLE' | 'AWAY' | 'RETIRED'
- `targetGames`: number
- `partners`: string[]

## 2. Key Logic Requirements

### Event Creation (FR-001, FR-002)
- Create a new event with a unique name.
- Initialize player list, game history, and court assignments.
- All data must be isolated per event instance.

### Player Registration (FR-005)
- Add players to an event, ensuring names are unique within the event.
- Registration happens inside an event, with multi-select from existing players or creating new ones.
- A minimum of 4 players must be registered to start scheduling.
- Before event start: players can be unregistered.
- After event start: unregistration is not allowed; instead, player can be marked 'RETIRED'.

### Player Status Lifecycle (FR-006, FR-008)
- Before event starts: status is effectively 'WAITING' in registration phase.
- After event start:
  - 'WAITING' → can be marked 'AWAY' or 'RETIRED'
  - 'AWAY' → can return to 'WAITING' (come back)
  - 'PLAYING' → assigned to a court
  - 'RETIRED' → permanently out (cannot rejoin)
  - 'UNAVAILABLE' → permanently out
- AWAY players are excluded from scheduling but can return later.
- Scheduling keeps room for AWAY players to comeback and complete target games (default minimum 6).

### Event Start (FR-009)
- Button text: **Start Event** (not Start Game)
- Requires at least 4 registered players.
- Once started, all non-retired registrations become 'WAITING'.
- Further unregistration from the event is blocked.

### Court-Centric Game Flow (FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-017, FR-018)
- After event start, courts are shown in **Available** state.
- Available courts show **Allot Players** button.
- Clicking **Allot Players** automatically assigns the next batch of 4 players to that court from the waiting pool.
- Allotted court shows assigned teams and **Start Game** button.
- After **Start Game**, court becomes **Occupied** showing:
  - Team 1 and Team 2 with player names
  - Score input fields for both teams
  - **Save Score** button
  - **End Game** button
- **End Game** validates score: one team must have reached at least 11 points and won by 2.
- After game ends:
  - Court becomes **Available** again
  - Players return to 'WAITING' status
  - Game moves to completed history
  - Stats updated

### Game Scheduling Logic (FR-019, FR-020, FR-021)
- Prioritize players furthest below the event's average games played count.
- Ensure no player is paired with the same partner more than once per event.
- Exclude UNAVAILABLE, AWAY, and RETIRED players from scheduling.
- Dynamic target adjustment when availability changes.

### Event Completion (FR-003, FR-016)
- An event is complete when the predetermined total number of games are played and player targets are met as closely as possible.
- Deadlock Handling: If a game cannot be scheduled, display a clear reason and blocking constraints.

## 3. Frontend Requirements

### Events List
- Create event, delete event, open event detail.

### Event Detail - Registration Phase (Before Start)
- Event name and registration header.
- Progress: Registered count, Target Games, Courts.
- Players list with Unregister button per player.
- **+ Add Players** button:
  - Shows list of available global players with multi-select checkboxes.
  - Search bar to type name and press Enter to create and auto-select new player.
- **Start Event** button (disabled until >= 4 players).

### Event Detail - Game Phase (After Start)
- Event name and started timestamp.
- **Courts section**:
  - Each court card shows:
    - Court header
    - If Available: "Available" label + **Allot Players** button
    - If Occupied (allotted, not started): assigned teams list + **Start Game** button
    - If Occupied (started): assigned teams list + score inputs + **Save Score** + **End Game** buttons
- **Players section** (collapsible/shrinkable):
  - Expand/collapse toggle header
  - Groups: Waiting, Playing, Away, Retired
  - Each group shows player name, games played, status actions:
    - Waiting: **Away**, **Retire** buttons
    - Away: **Come Back** button
    - Playing/Retired: no actions
- **Add Players** button remains available after start.
- **Completed Games** list with scores.

### Players Tab
- Create player, delete player.
- Register button removed; registration only from inside an event.

## 4. API Endpoints

### Event Management
- `POST /events` – Create event. Body: `{ name, totalGamesToPlay, numCourts }`.
- `GET /events` – List events.
- `GET /events/:eventId` – Event details.
- `DELETE /events/:eventId` – Delete event.
- `POST /events/:eventId/start` – Start event. Returns success.
- `GET /events/:eventId/status` – Returns event status with courts, player status counts, active games.

### Player Management
- `POST /players` – Create global player. Body: `{ name }`.
- `GET /players` – List all players.
- `GET /players/:playerId` – Get player details.
- `DELETE /players/:playerId` – Delete global player.

### Event Player Registration
- `POST /events/:eventId/players` – Register player. Body: `{ player_id?, name?, status? }`.
- `PATCH /events/:eventId/players/:playerId` – Update player status. Body: `{ status }`.
- `DELETE /events/:eventId/players/:playerId` – Unregister player (pre-start only).

### Court Management
- `POST /events/:eventId/courts/:courtId/allot` – Allot 4 players to specific court.

### Game Flow
- `POST /events/:eventId/games/:gameId/start` – Start game for score entry.
- `POST /events/:eventId/games/:gameId/score` – Save scores. Body: `{ score_team1, score_team2 }`.
- `POST /events/:eventId/games/:gameId/end` – End game with validation (must reach 11+ and win by 2).
- `GET /events/:eventId/games` – List completed games.

### Utilities
- `GET /api` – API info.

## 5. Potential Challenges & Edge Cases

- **Dynamic Target Adjustment Complexity**: Implementing fair distribution, especially with frequent availability changes, can be complex. The "fair as possible" and "prioritize furthest below average" rules need careful implementation.
- **Simultaneous Game Scheduling**: Multiple courts can be allotted and started independently.
- **AWAY Player Comeback**: Scheduling must leave room for AWAY players to return and still reach minimum 6 games.
- **Score Validation**: End game enforces 11+ points and 2-point lead.
- **Player Identification**: Global UUID-based player IDs ensure uniqueness across events.

## 6. Validation Steps

### Scenario 1: Perfect Play
- Simulate an event with exactly 12 players, all available, and verify it completes in 18 games with each player having played 6 games.

### Scenario 2: Dynamic Adjustment
- Simulate player away/retire mid-event and verify that scheduling continues, prioritizing those with fewer games, and that the event still concludes with fair game distribution.

### Scenario 3: Deadlock
- Create a situation where scheduling is impossible (e.g., only 3 players available, or all available players have played with each other) and verify the deadlock handling mechanism.

### Scenario 4: Player Count
- Test with fewer than 4 players to ensure scheduling doesn't initiate.

### Scenario 5: Court Flow
- Start event with 2 courts.
- Verify available courts show Allot Players.
- Verify allotted court shows Start Game.
- Verify started court shows score inputs and End Game.
- Verify End Game enforces 11+ and win-by-2.
- Verify court becomes available after end.

## 7. Persistence
- Database persisted to `db.json` in project root.
- All mutations (create event, register player, allot game, start game, end game, update status, delete) persist to disk.
- Server defaults to port 4444.
