# Auto-Allotment by Priority

## Overview

Auto-allot assigns waiting players to available courts before each game using a multi-tier priority system. The highest priority is ensuring new or returning-never-played players get their first game. Among equal priority tiers, players with fewer games played get precedence, broken randomly for exact ties. Partnership repetition avoidance is the paramount rule — the scheduler rejects any grouping that would repeat a prior teammate pair, and only overrides the priority order when no valid grouping exists under the partnership rule.

## Priority Tiers

All priority values are integers. Higher numeric values mean higher priority for court selection.

| Priority | Label         | Numeric Value |
|----------|---------------|---------------|
| NewPlayer | Never played a single game | 10 |
| BackToBack | Played in the immediately previous game | 7 |
| JustWaiting | Waiting with no special status | 5 |
| Completed | Already fulfilled target game count | 0 |

Rules governing priority assignment:

- A player who has never played even a single game receives `NewPlayer` (10).
- An `AWAY` player who returns to `WAITING` and has never played a single game also receives `NewPlayer` (10).
- A player whose `gamesPlayedCount >= targetGames` is marked `Completed` (0) and remains out of the waiting pool until otherwise updated.
- At the end of each completed game, the system inspects the current waiting pool:
  - If there are zero `NewPlayer` players remaining, or fewer than 3 `NewPlayer` players remain, one player from the four players who just completed the current game is promoted to `BackToBack` (7). All other three players from that completed game are set to `JustWaiting` (5).
  - Any of those four players who is already `BackToBack` is downgraded to `JustWaiting` (5) after the game ends; the promotion above always picks a fresh candidate.
  - If there are 3 or more `NewPlayer` players remaining at game end, all four players from the just-completed game become `JustWaiting` (5).

## Trigger Points

- **POST /events/:eventId/schedule** — auto-selects the next open court (court 1 by default).
- **POST /events/:eventId/courts/:courtId/allot** — targets a specific court.

Both endpoints call `SchedulingService.assignNextGame()`.

## Step 1: Build the Candidate Pool

`getAvailablePlayers()` in `src/services/SchedulingService.ts` filters the event roster to players whose `registration.status === 'WAITING'` and whose priority is greater than 0. The `Completed` (0) tier is never eligible unless a future rule explicitly revives fulfilled players.

The waiting players are then sorted descending by numeric priority. If two players share the same priority, the tie is broken by fewer games played first. If both priority and games played are equal, the order is randomized using a comparator seeded with `Math.random()`.

## Step 2: Handle Existing Allotment on Target Court

Before forming a new group, the scheduler checks whether the target court already has an uncompleted allotment:

- If the existing allotment has already started, allocation is rejected (game currently in play).
- If the existing allotment has not started, those 4 players are released back to `WAITING`, the allotment is removed, and allocation proceeds with a fresh group.

When more than 4 waiting players exist and the court previously held allotment players, those previous allotment players are temporarily excluded from the new candidate set (if doing so still leaves at least 4 eligible players). This spreads selections across the broader pool without violating the primary partnership rule.

## Step 3: Team Formation Enforcing No Repeat Partners

The algorithm attempts up to `min(availablePlayers.length, 30)` configurations. For each attempt:

1. From the sorted candidate pool, pick the first player as `topPlayer`.
2. Find a partner for `topPlayer` who has never appeared in `topPlayer.partners` before.
3. From the remaining players, find an opponent pair where the two have also never been partners.
4. If both conditions are met, finalize teams.

If no valid grouping is found after 30 attempts, the scheduler returns `shouldWait: true`. The frontend displays a deadlock error and suggests releasing players from `AWAY` / `RETIRED` to unlock new combinations.

**Crucially, the priority order may be overridden only when a violation of the no-repeat-partner rule would otherwise prevent forming a valid group of 4.**

## Step 4: Manual Supplements

If a user has manually placed fewer than 4 players on a court, the remaining slot(s) are filled from the same filtered, priority-sorted waiting pool, still respecting the no-repeat-partner rule. Manual placements are treated aslocked for the current allotment cycle; the automatic portion cannot displace them.

## Step 5: Create and Assign Game

Once a valid 4-player group is found (under the partnership rule):

- A `Game` object is created via `createGame(eventId, courtId, playerIds)`.
- All 4 selected players are updated to `PLAYING`.
- The game is appended to `event.games`.
- State is persisted.

## End-of-Game Priority Update (Step 6)

When a game ends (`POST /events/:eventId/games/:gameId/end`), after score validation and play-count increment:

- For each of the 4 players in the finished game:
  - Increment `gamesPlayedCount`.
  - If `gamesPlayedCount >= targetGames`, set status to `AWAY`.
  - Else set status to `WAITING`.
- Record the teammate in each player's `partners` array (no duplicates).
- Run the priority recency check described in the Priority Tiers section:
  - Evaluate how many waiting players currently carry `NewPlayer` status.
  - Promotions and downgrades are applied atomically before the next allotment cycle.

## Priority Override Policy

Because avoiding partnership repetition is the PRIMARY RULE, the scheduler may deviate from the computed priority ranking if:

- A strictly priority-respecting draw fails after 30 attempts to construct a legally partnered quartet.
- Manual placement constraints reduce the auto pool to fewer than 4 players who can form a non-repeating group without a new conflict.

In override mode, the retaining partner-set prevention still applies; the system simply relaxes the priority sort order to find any workable 4-player set.

## Files Involved

- `src/services/SchedulingService.ts` — priority assignment, deficit/priority sorting, partner checks, team formation, end-of-game priority recalculation.
- `src/routes/gameRoutes.ts` — allotment endpoints and persistence.
- `src/models/Event.ts` — player/registration state transitions.
- `src/models/Player.ts` — `gamesPlayedCount`, `partners`, and priority label/value storage.
- `public/app.js` — frontend allot buttons and deadlock messaging.

## Notes

- Priority assignment only compares across `WAITING` players. `PLAYING`, `AWAY`, `RETIRED`, or `UNAVAILABLE` players are ignored until they return to `WAITING`.
- The 30-attempt cap prevents long loops when partner rules are too restrictive.
- Random tie-breaking does not override the partnership avoidance rule; it only shuffles equivalent priority/game-count tiers.
- `Completed` players remain out of the waiting pool during the current event. Resurrecting them requires an explicit future rule change.
