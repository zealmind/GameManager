# Auto-Allotment: Order-By-Deficit

## Overview

Auto-allot assigns waiting players to available courts before each game. The scheduler tries to keep play counts fair by prioritizing players who have played fewer games than the event average. When play counts are tied, it breaks ties randomly. It also avoids repeat partner pairings within the same event when possible.

## Trigger Points

- **POST /events/:eventId/schedule** — auto-selects the next open court (court 1 by default).
- **POST /events/:eventId/courts/:courtId/allot** — targets a specific court.

Both endpoints call SchedulingService.assignNextGame().

## Step 1: Build the Candidate Pool

getAvailablePlayers() in src/services/SchedulingService.ts:20-38 filters the event roster to players whose registration.status === 'WAITING'. For each waiting player it computes:

    deficit = average games played across all registrations - this players games played count

Players are then sorted primarily by deficit ascending (lowest deficit first). That means players furthest below the average get priority. If two players have effectively the same deficit (difference smaller than 0.001), their relative order is randomized using Math.random() - 0.5. The shuffle happens on every scheduling call, so identical histories still yield varied court assignments.

## Step 2: Reuse / Reject Prior Allotments

Before forming a new group, the scheduler checks whether the target court already has an uncompleted allotment:

- If the existing allotment has already started, allocation is rejected (game currently in play).
- If the existing allotment has not started, those 4 players are released back to WAITING, the allotment is removed, and allocation proceeds with a fresh group.

When there are more than 4 waiting players and the court previously had allotment players, those previous allotment players are excluded from the new candidate pool (if possible). This helps spread the group selection across the pool.

## Step 3: Team Formation With Partner Rules

The algorithm attempts up to min(availablePlayers.length, 30) configurations. For each attempt:

1. Pick the first available player as topPlayer.
2. Find a partner for topPlayer who has not appeared in topPlayer.partners before.
3. From the remaining players, find an opponent pair where those two also have not partnered with each other.
4. If both conditions are met, build teams and finalize.

If no valid grouping is found after 30 attempts, the scheduler returns shouldWait: true. The frontend shows a deadlock error and suggests releasing players from AWAY / RETIRED to create new combinations.

## Step 4: Create and Assign Game

Once a valid 4-player group is found:

- A Game object is created via createGame(eventId, courtId, playerIds).
- All 4 selected players are updated to PLAYING.
- The game is appended to event.games.
- State is persisted.

## End-to-End Lifecycle (One Slot)

1. **Allot** — scheduler selects 4 players and creates the game.
2. **Start** — POST /events/:eventId/games/:gameId/start sets started = true.
3. **End** — POST /events/:eventId/games/:gameId/end validates the score, then for each player:
   - Increments gamesPlayedCount
   - If gamesPlayedCount >= targetGames then status = 'AWAY'
   - Else status = 'WAITING'
   - Records teammate in partners array (no duplicates)
4. **Repeat** until gameHistory.length >= totalGamesToPlay
5. **Complete** — event flags as complete once the total scheduled games are finished.

## Files Involved

- src/services/SchedulingService.ts — deficit sorting, partner checks, team formation.
- src/routes/gameRoutes.ts — allotment endpoints and persistence.
- src/models/Event.ts — player/registration state transitions.
- public/app.js — frontend allot buttons and deadlock messaging.

## Notes

- Deficit ordering only compares across waiting players. Players already PLAYING, AWAY, RETIRED, or UNAVAILABLE are ignored until they return to WAITING.
- The 30-attempt cap prevents long loops when the partner rules are too restrictive.
- Random tie-breaking does not override the deficit fairness rule; it only shuffles equivalent tiers. 


