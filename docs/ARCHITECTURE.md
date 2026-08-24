# False Arrow Architecture

Last updated: 2026-08-24 - Runtime sprite atlases

## Project Overview

False Arrow is a multiplayer top-down pixel-art labyrinth game built as a TypeScript monorepo with three workspace packages:

- `packages/shared`: shared constants, protocol types, procedural map generation, navigation, and collision.
- `packages/server`: the authoritative multiplayer simulation and room management.
- `packages/client`: the authenticated DOM app shell plus the lazy PixiJS renderer, client prediction, interpolation, HUD, and input handling.

Supabase provides browser authentication, owner-private profile storage, and
owner-private competitive records. It also stores the protected
`profiles.is_admin` permission. The WebSocket server verifies the caller's
Supabase token and re-reads identity, rating, and permission through RLS; client
claims never grant identity, rating, or administrator capabilities. A trusted
server-only RPC atomically records every completed-match ledger, updates every
authenticated player's win/loss record, and changes ratings only for eligible
matches. Supabase does not participate in the live
authoritative simulation.

The Main Menu administrator console is also server-authoritative. Its HTTP API
revalidates the caller's Supabase token, active `profiles.is_admin` permission,
and `profiles.suspended_at` state on every request. A server-only Supabase client
joins Auth email/sign-in metadata with profiles and player statistics, reads the
protected completed-match ledger, and applies transactional profile, role, and
suspension changes. It also owns the persisted Community Round date, time, and
daily/weekly/monthly recurrence. The schedule is publicly readable so every
menu renders the same event, while its mutation remains active-admin-only.
User changes are appended to `admin_audit_log`; the browser never receives a
Supabase secret or direct access to protected tables.

Browser-local tutorials report lifecycle events through a separate HTTP API.
Authenticated starts are resolved from a freshly verified Supabase token;
guests retain their tab-scoped identifier and display-name snapshot. The server
stores all attempts in the RLS-protected `tutorial_sessions` ledger and returns
an opaque per-attempt update credential. Heartbeats and best-effort unload
events distinguish active, completed, and abandoned sessions without making
analytics availability a prerequisite for local tutorial play.

One room owns one maze instance. The server is authoritative for player state, hidden role seats, runestones, treasure-chest state, sword-field state, portal state, and wisdom orbs. The client predicts local movement for responsiveness, reconciles against server snapshots, and interpolates remote players for smoother motion.

## Tech Stack

- Language: TypeScript across all packages
- Client renderer: PixiJS 8
- Client bundler/dev server: Vite
- Server transport: uWebSockets.js
- Workspace tooling: npm workspaces
- Quality tooling: TypeScript, ESLint, Prettier

## Multiplayer Architecture

### Authoritative Server Model

- The server is the single source of truth for room state.
- Clients send intent messages such as movement, runestone activation, and wisdom-orb use.
- The server simulates the room at `20` ticks per second.
- Each room owns:
  - one generated maze
  - one player list
  - one runestone state array
  - one treasure-chest state array
  - one sword-field state array
  - one portal position selected during room creation
  - one portal activation flag
  - one precomputed hub-distance field for phase 1 wisdom guidance
  - one optional portal-distance field for phase 2 wisdom guidance

### Room Lifecycle

1. A client starts loading game assets, connects in parallel, and sends `JOIN_ROOM` in `quick`, `create`, or `join` mode.
2. Quick Play reuses the first joinable public room or creates one. Private creation returns a generated six-character code; private joining requires an existing code.
3. Waiting rooms are event-driven and broadcast `LobbyState` only when their roster, votes, or countdown changes. They do not run the 20 Hz simulation loop.
4. Nine connected players start an eight-second countdown automatically. With 6-8 players, start voting unlocks after 60 seconds and requires `ceil(connected players × 2 / 3)` votes.
5. When the countdown completes, the server locks and balances the roster, assigns hidden roles, changes the match to `loading`, broadcasts the loading lobby phase, and privately sends `ROOM_JOINED`. Every client shows **Game is starting…**, builds its initial maze behind the loading screen, and replies with `GAME_READY`.
6. The server keeps the timer and fixed tick loop stopped until every occupied seat is connected and ready. It then sets one ten-minute wall-clock deadline, broadcasts `MATCH_STARTED`, and releases every loaded client into the maze. An unready client is removed after the bounded 60-second loading timeout so it cannot hold the room forever.
7. An unexpected socket close marks the occupied seat disconnected for 45 seconds. A waiting-room countdown is cancelled; during match loading, the ready roster waits for that seat to reconnect and rebuild or expire.
8. A valid private reconnect token restores the same player id and authoritative lobby, loading, running, or ended state. Explicit leave releases the seat immediately.
9. Grace expiry performs permanent player removal and recalculates match thresholds. The room stops and is destroyed only after its final occupied or reserved seat is released.

### Simulation and Reconciliation

- Clients send `PLAYER_INPUT` messages with a monotonically increasing `sequenceNumber`.
- The server queues inputs per player and consumes all queued inputs on the next tick.
- The client predicts its own movement immediately using the same shared collision logic as the server.
- On `TICK_UPDATE`, the client:
  - snaps to authoritative local state
  - drops acknowledged pending inputs using `lastProcessedInput`
  - reapplies still-pending local inputs
  - interpolates remote players from buffered snapshots

### Network Protocol

#### Client -> Server

| Message                   | Purpose                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `JOIN_ROOM`               | Join or create a room with a display name                                                                                                   |
| `RECONNECT_ROOM`          | Reclaim a reserved seat with its private per-tab bearer token                                                                               |
| `LEAVE_ROOM`              | Explicitly release the current seat without a reconnect grace period                                                                        |
| `VOTE_TO_START`           | Cast or withdraw the local player's underfilled-start vote                                                                                  |
| `SEND_LOBBY_CHAT`         | Submit one server-validated room-wide waiting-room message                                                                                  |
| `GAME_READY`              | Confirm that runtime assets and the recipient's initial maze scene are ready                                                                |
| `PLAYER_INPUT`            | Send one frame of movement intent plus `sequenceNumber`                                                                                     |
| `ACTIVATE_RUNESTONE`      | Request activation of a nearby runestone                                                                                                    |
| `OPEN_CHEST`              | Request opening a nearby unopened treasure chest                                                                                            |
| `PRESS_PRESSURE_PLATE`    | Warden-only request to latch a nearby gate button                                                                                           |
| `PRESS_SPIKE_PLATE`       | Warden-only request to latch a nearby spike-gate plate                                                                                      |
| `ACTIVATE_TRAP_CELL`      | Warden-only request to fire the shared trap network from a nearby 6x6 trap cell                                                             |
| `OPEN_CAGE`               | Outside-player request to open a nearby prisoner's cage                                                                                     |
| `USE_WISDOM_ORB`          | Survivors spend an orb on a nearby reveal/clear or request direction; wardens may use the same proximity request only to clear sword fields |
| `SEND_CHAT_MESSAGE`       | Submit one server-validated proximity-chat message                                                                                          |
| `ESCAPE_PORTAL`           | Survivor request to enter the active portal after a shared 28px proximity check                                                             |
| `DEBUG_TELEPORT`          | Debug-only teleport helper used by developer tooling                                                                                        |
| `DEBUG_SET_MATCH_TIME`    | Debug-only authoritative match timer adjustment                                                                                             |
| `DEBUG_SET_NETWORK_STATS` | Admin-only request that toggles the room-wide in-match network-stat HUD                                                                     |
| `DEBUG_SET_TOOLS_ENABLED` | Admin-only sync of the local debug-tools switch used for global chat routing                                                                |

#### Server -> Client

| Message                    | Purpose                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ROOM_JOINED`              | Initial or resumed match payload with `playerId`, `mapSeed`, full `gameState`, verified admin status, and the recipient's private role/orb inventory   |
| `MATCH_STARTED`            | Release a fully loaded roster with the first shared running state and authoritative ten-minute deadline                                                |
| `LOBBY_JOINED`             | Private lobby admission with the server player ID and current `LobbyState`                                                                             |
| `LOBBY_UPDATED`            | Event-driven public roster, vote, or countdown replacement state                                                                                       |
| `LOBBY_CHAT_MESSAGE`       | Transient room-wide waiting-room chat event                                                                                                            |
| `TICK_UPDATE`              | Authoritative room snapshot broadcast every server tick                                                                                                |
| `PLAYER_LEFT`              | Notify clients that a seat was permanently released after leave or grace expiry                                                                        |
| `RUNESTONE_ACTIVATED`      | Broadcast that one runestone is now active                                                                                                             |
| `ALL_RUNESTONES_ACTIVATED` | Broadcast the existing portal coordinates once all runestones are active                                                                               |
| `CHEST_OPENED`             | Broadcast a chest's shared opened state and opener                                                                                                     |
| `WISDOM_ORB_GRANTED`       | Privately provide a rewarded survivor's post-reward orb count; wardens receive no reward message                                                       |
| `WISDOM_ORB_USED`          | Private accepted-action response containing the result and remaining orb count; warden sword clears leave the count at zero                            |
| `PLAYER_ROLE_CHANGED`      | Private debug response that replaces the recipient's role and orb inventory                                                                            |
| `DEBUG_PLAYER_ROLE`        | Private debug response containing a selected player's authoritative role                                                                               |
| `TRAP_ACTIVATION_RESULT`   | Private result used for the activating Warden's empty-room feedback                                                                                    |
| `PLAYER_TRAPPED`           | Private cage ID notification that opens the captured Survivor's instructional typewriter dialogue                                                      |
| `CHAT_MESSAGE`             | Transient message with the sender's public squad ID, normally delivered within 10 tiles; debug-enabled admins receive every message and send room-wide |
| `PLAYER_ESCAPED`           | Room-wide authoritative escape notification with portal coordinates and current victory progress                                                       |
| `MATCH_ENDED`              | Immutable survivor/warden result with final escape progress, remaining time, and the role-revealing final roster                                       |
| `ERROR`                    | Report room-join or protocol errors                                                                                                                    |

### Shared State Contracts

#### `LobbyState`

| Field                      | Type                       | Notes                                                                   |
| -------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| `roomId`                   | `string`                   | Six-character public/private room code                                  |
| `phase`                    | `'waiting' \| 'countdown'` | Current pre-game room phase                                             |
| `players`                  | `LobbyPlayerInfo[]`        | Occupied nicknames plus public vote and connected/reconnecting presence |
| `minPlayers`, `maxPlayers` | `number`                   | Early-start minimum (`6`) and room capacity (`9`)                       |
| `votesRequired`            | `number`                   | Current two-thirds threshold                                            |
| `voteAvailableAt`          | `number`                   | Server wall-clock timestamp for enabling early-start voting             |
| `countdownEndsAt`          | `number \| null`           | Server wall-clock countdown deadline                                    |
| `startReason`              | `'full' \| 'vote' \| null` | Why the roster became locked                                            |

#### `PlayerInfo`

| Field                | Type                                  | Notes                                                                             |
| -------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| `id`                 | `string`                              | Server-generated player id                                                        |
| `displayName`        | `string`                              | Client-provided display name                                                      |
| `teamId`             | `number`                              | Team assignment used for spawn grouping                                           |
| `spriteIndex`        | `number`                              | Client sprite-sheet selection                                                     |
| `x`, `y`             | `number`                              | Bottom-center feet position in world pixels                                       |
| `facing`             | `'up' \| 'down' \| 'left' \| 'right'` | Authoritative sprite facing                                                       |
| `isMoving`           | `boolean`                             | Current movement animation state                                                  |
| `connected`          | `boolean`                             | Seat currently has an attached WebSocket rather than being inside reconnect grace |
| `escaped`            | `boolean`                             | Survivor has entered the portal and is now an inactive spectator                  |
| `lastProcessedInput` | `number`                              | Highest acknowledged local input sequence                                         |

Roles and wisdom-orb inventories are intentionally absent from `PlayerInfo` and public snapshots. `ROOM_JOINED` privately provides the recipient's `role` (`'survivor' | 'warden'`) and starting `wisdomOrbs`; later orb changes use the private `WISDOM_ORB_USED` response.

#### `RunestoneInfo`

| Field            | Type      | Notes                                     |
| ---------------- | --------- | ----------------------------------------- |
| `index`          | `number`  | Runestone slot `0`, `1`, or `2`           |
| `tileX`, `tileY` | `number`  | Tile coordinates inside the generated map |
| `activated`      | `boolean` | Authoritative activation state            |

#### `GameState`

| Field                 | Type                               | Notes                                                                                                                          |
| --------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `tick`                | `number`                           | Authoritative simulation tick counter                                                                                          |
| `match`               | `MatchState`                       | Running/ended status, remaining time, escape progress, threshold, winner, and the role-revealing final roster after completion |
| `players`             | `PlayerInfo[]`                     | All occupied players, including temporarily disconnected reserved seats                                                        |
| `runestones`          | `RunestoneInfo[]`                  | Three runestones with activation state                                                                                         |
| `portal`              | `{ x: number; y: number } \| null` | Portal world position in pixels, normally selected during room creation                                                        |
| `bridgeStates`        | `BridgeState[]`                    | Authoritative missing-stone mask for every generated bridge                                                                    |
| `chestStates`         | `ChestState[]`                     | Authoritative opened/unopened state for every generated treasure chest                                                         |
| `swordFieldStates`    | `SwordFieldState[]`                | Authoritative blocking, lowering, and cleared state for every generated sword field                                            |
| `gateStates`          | `GateState[]`                      | Authoritative open/closed state for every generated gate                                                                       |
| `pressurePlateStates` | `PressurePlateState[]`             | Authoritative physical-press and warden-latch state for every gate button                                                      |
| `spikeGateStates`     | `SpikeGateState[]`                 | Authoritative open/closed state for every active colored barrier in each spike-gate obstacle                                   |
| `spikePlateStates`    | `SpikePlateState[]`                | Authoritative physical-press and warden-latch state for each spike gate's two nearest plates                                   |
| `cageStates`          | `CageState[]`                      | Authoritative spawned, opened, and permanently vacated cage state                                                              |

## Shared Gameplay Systems

### Collision and Movement

- Shared movement constants and collision helpers live in `packages/shared/src/physics.ts`.
- Both client and server use the same feet-based collision logic.
- Player position is stored at the feet, not the sprite center, which keeps wall contact and sorting consistent.
- Closed gate tiles are solid map obstacles, so both client prediction and server simulation block on them automatically.
- Physical button occupancy treats wardens and survivors identically: two distinct players on the spawn-side buttons or one player on the hub-side button hold the gate open only while that physical requirement remains satisfied.
- Wardens can separately latch nearby buttons with `E`; when a latch completes one side's button requirement, the gate opens for five seconds, resets every associated button, and requires occupied buttons to be released before another activation cycle.
- Spike-gate obstacles use exact `13x95` vertical barriers in east-west passages and export-70 `95x9` horizontal barriers in north-south passages. Vertical compositions are limited to straight corridor sections and place the third yellow barrier in the authored slot above red. Each collider is removed independently while either of that colored gate's two nearest plates is occupied or manually latched by a Warden, with identical checks in client prediction and server simulation.
- Bridge obstacles use the same six authored rectangle/right-triangle bank colliders on the client and server. Their two-tile-wide spans also share dynamic collision masks so fallen stones expose impassable water consistently during prediction and authoritative simulation.
- Directional treasure dead ends use the same authored rectangle colliders on the client and server for their tree backing, rock, and every count-specific chest position.
- Decorated north- and south-closed T-junctions use orientation-specific style-editor rectangles for their bushes, rock, and signpost on both the predicting client and authoritative server. The south-closed variant's inferred prop colliders reuse the established object hitbox dimensions.
- Decorated vertical passages use the four foliage rectangles exported with style-editor layout (22) on both the predicting client and authoritative server.
- Sword fields preserve the ten small fence/marker colliders from the first editor export. The additional `149×32` central blocker from the second export remains solid through the shake-and-sink sequence and is removed only when the server marks the field cleared.
- Spawned cages use the shared dynamic-collider path and the editor-authored 18x14 base collider. Closed prisoners cannot change position, but their movement input still drives replicated facing and walk animation; opened prisoners may move only north/south until clear, while every other player collides with the cage. A vacated cage remains permanently solid.
- Collision respects the portal from the beginning of the match. Its authored wall cutout opens four tiles of walkable platform behind the arch, while mirrored rectangle and right-triangle edge colliders keep players inside the masonry and leave the central stairs open.
- The redesigned central hub is baked from the exact 1,293-sprite style-editor repaint. Its 23 exported rectangle/right-triangle colliders are shared by client prediction and server simulation, and its three runestones use exact pixel anchors for rendering and activation instead of their legacy tile hitboxes.

### Proximity Text Chat

- Chat messages contain at most `120` characters and are normalized to one trimmed line by the authoritative server.
- The server uses current authoritative player positions to deliver each message to the sender and every player within `160` world pixels (10 tiles). Walls do not block chat.
- Chat events are transient: they are not stored in `GameState` and are not replayed to late joiners.
- The client keeps only the latest four locally received messages. They fade after ten inactive seconds and return when the player reopens chat.
- Each room-wide `RUNESTONE_ACTIVATED` event adds a gold system message naming the wardstone color and showing the activated total (for example, `Blue wardstone activated. Wardstones active: 1/3.`).
- The room-wide `ALL_RUNESTONES_ACTIVATED` event adds a gold system message to every connected player's chat announcing that the escape portal is open.
- `PLAYER_ESCAPED` is also room-wide and adds a gold system message with the survivor's name and the remaining escape target. Escaped spectators receive these system events but are excluded from normal proximity-chat sending and delivery.

Waiting-room chat uses the same normalization, 120-character limit, and per-player cooldown, but is delivered to the whole lobby. It remains transient and is not written to Supabase or replayed to later arrivals.

### Runestones and Portal Flow

- The generated map contains exactly three runestone tiles inside the hub area.
- The server validates runestone activation by proximity before accepting a request.
- During room creation, the server computes one portal position farther from the hub than player spawns. It is centered at the wall between two vertically adjacent 6×6 cells, and both cells must retain their north forest walls.
- When all three runestones are active, the server broadcasts the existing portal position and the client plays its light-up animation.
- Only an unescaped survivor within `28` pixels of the active portal may submit `ESCAPE_PORTAL`. The server marks that player escaped before broadcasting the event; clients animate the character into the portal and hide it.
- Wisdom orbs switch from hub guidance to portal guidance only after the portal is activated.
- The portal is a world entity, not a tilemap tile.

### Match Timer and Victory

- Completing the lobby countdown begins the synchronized loading phase. Only after every occupied client sends `GAME_READY` does the server start the `600000ms` wall-clock deadline; snapshots expose authoritative remaining time and the client interpolates the top-center `MM:SS` display between ticks.
- A full room requires five survivor escapes. Underfilled rooms use `max(1, ceil(occupied survivors × 5 / 7))`; temporary disconnects preserve that population during grace, while final leaves, expiry, and debug role changes recalculate it.
- Reaching the threshold, or having every occupied survivor escaped, ends the match immediately for survivors. Reaching the deadline below the threshold ends it for wardens, including action requests that race the next server tick.
- Ending is immutable: queued input is cleared, the server loop stops, gameplay/chat requests are rejected, a final snapshot is broadcast, and clients freeze under a persistent result panel. The panel reveals Survivor and Warden rosters only after completion.

### Competitive Records and Team Elo

- Every authenticated profile has a `player_stats` row starting at `1200` Elo with zero total matches, rated matches, wins, and losses. The main menu and profile read these owner-private counters directly from Supabase; completed-match history is stored in `matches`, authenticated roster results in `match_participants`, and guest names, roles, outcomes, and final states in `match_guest_participants`.
- To keep low-population queues usable, Quick Play still fills the first available public lobby without a rating filter. Rating-aware queue grouping is deferred until concurrency supports it.
- A match is rated only when a public room starts normally with a full roster of 9 distinct authenticated profiles and server-side match persistence is configured. Underfilled games, private games, guest-containing games, administrator-altered games, and debugged matches are unranked.
- Every completed match gets a persistent ledger row. It increments total matches and either wins or losses for each authenticated starting player, even when the match is private, underfilled, contains guests, or is otherwise unranked. Guests are retained only as match participants and never receive profiles, Elo, or account counters; guest-only matches therefore have no profile counters to update.
- The server captures the complete starting roster before play. Permanent leavers remain in the result ledger and are marked abandoned, so leaving cannot erase a loss or match result.
- Survivor and Warden team strength use average rating because the sides have different player counts. The first ten rated matches use `K=40`; established players use `K=24`; ratings have a floor of `100`.
- Only the team result affects Elo. Escapes and abandonment are retained for auditing and future statistics but do not award performance bonuses.
- Every match has a server-generated UUID. The service-role-only `record_match_result_with_guests` database function wraps the authenticated match/counter update and guest roster insert in one idempotent transaction. Unranked authenticated participants receive a zero rating change, guests receive no rating fields, and only `rated_matches` controls the provisional K-factor.

### Administrator Operations

- Active administrators see **Admin menu** directly below **Tutorial**. The
  responsive DOM console contains registered Users, Ongoing rounds, Past
  rounds with participant drilldown, a Tutorials funnel/history tab, the
  administrator-only Style Editor link, and a Scheduled rounds dialog for the
  shared Community Round calendar.
  Administrative mutations remain recorded in the server-only audit ledger but
  are not displayed in the console.
- Scheduled rounds store an anchor date, host-local time, IANA time zone, and
  daily, weekly, or monthly recurrence. Calendar calculations retain that local
  wall-clock time across daylight-saving changes; player menus fall back to the
  bundled daily schedule if the public read endpoint is temporarily unavailable.
- Summary and live-room snapshots refresh every ten seconds while the view is
  visible. Persistent counts are cached for thirty seconds; manual Refresh also
  reloads the active persistent tab.
- Users are Auth accounts joined to `profiles` and `player_stats`; transient
  guests appear in live room rosters and aggregate online counts. Once a round
  completes, its guest display names and roles are also visible in that
  round's participant details.
- Profile edits, admin-role changes, suspensions, and reactivations use
  service-role-only database functions. An administrator cannot demote or
  suspend themselves, promote a suspended user, or remove the final active
  administrator.
- Suspension first sets the application block, removes any live seat, records
  abandonment, disables Elo for the altered round, and then applies a long
  Supabase Auth ban. Reactivation clears the Auth ban before removing the app
  block. Existing bearer tokens are rejected through `suspended_at` even before
  their JWT expires.

### Hidden Roles and Wisdom Orbs

- A full room has `7` survivors and `2` wardens. Six-player early starts use one Warden; seven- and eight-player starts use two. When two Wardens are present they occupy different squads.
- Each survivor starts with `1` wisdom orb; wardens start with `0`. A warden cannot request navigation or private route hints, but can use the shared interaction request to clear a nearby sword field without an orb.
- Survivors may carry at most `3` wisdom orbs. Opening a nearby unopened chest grants one orb only when the survivor is below that cap. Wardens can instead open and permanently consume a chest without granting an orb to anyone.
- Roles and wisdom orbs are server-authoritative private room state. They are never included in broadcast `GameState` snapshots.
- Nearby bridge and swamp route reveals are tracked privately per player. The first orb reveals that obstacle's safe route; later orb uses near the same revealed obstacle return normal hub/portal direction guidance instead of replaying the reveal.
- Near either entrance of a blocking sword field, a survivor's orb or a warden's unlimited `E` interaction starts a shared `1.2s` lowering sequence. All clients render the sword shake, cyan/gold magic sparkles, sinking, and disappearance from the replicated state.
- Shared phase-aware guidance lives in `packages/shared/src/navigation.ts`.
- `computeHubDistanceField()` builds the phase 1 pathfield toward the central hub.
- `computePortalDistanceField()` builds the phase 2 pathfield toward walkable portal-approach tiles around the blocked portal collider.
- When a generated map contains closed gates, wisdom guidance falls back to tile-ray direction selection so hints do not point through a gated cell.
- `getNavigationDirectionForPosition()` converts the player's feet position to a tile and returns one of:
  - `north`
  - `east`
  - `south`
  - `west`
- The hint logic is branch-aware. It chooses from locally open exits that the player can actually take from the current cell or passage, rather than pointing at the target's raw absolute bearing through walls.

### Treasure Chests

- Exactly 60% (rounded to the nearest whole cell) of eligible non-spawn maze dead ends are deterministically selected as chest cells. Each selected cell then chooses one, two, or three independently indexed chests with a 70% / 24% / 6% weighted split.
- Dead ends extending south or east use the new right-side tree-and-flower variant; dead ends extending north or west use the original north-side variant. The stored opening direction points back into the maze and is therefore the opposite compass direction.
- Two- and three-chest cells use their exact style-editor arrangements and matching colliders rather than offsetting the one-chest prefab at runtime.
- The server validates the opener's role-specific eligibility, distance, current inventory, and the chest's unopened state before accepting `OPEN_CHEST`. Survivors receive one orb; wardens only consume the chest.
- Opening swaps all clients to the authored `chest01 16` sprite and plays a short blue wisdom-magic burst.
- Open state persists in `GameState.chestStates`, so late joiners see the correct sprite without replaying the opening effect.

### Sword Fields

- Before other obstacle placement, generation reserves non-overlapping qualifying east-west passages so every team's computed direct spawn-to-hub route contains exactly one sword field. One or more additional deterministic fields are scattered only outside those direct routes. They never overlap spawns, the hub, bridges, swamps, treasure cells, or the portal platform.
- Survivors see `[ Q ]` at either still-blocked entrance. With an orb, keyboard `Q`, mobile `Q`, clicking the prompt, and clicking the orb HUD all use the same server-validated request; without an orb, the same prompt explains that one must be found before the field can be passed.
- Wardens instead see a red `[ E ]` and may clear any number of encountered fields with keyboard/mobile `E`; they spend no orb.
- The server consumes one orb only for survivors, records the lowering start tick, keeps the main collider active for the full animation, then marks the field cleared. Late joiners reconstruct the correct visual phase from the current server tick.
- Fence, grave, and ground art remain after all forty-one swords disappear, matching the supplied editor layout.

### Spike Gates

- Each deterministic spike-gate obstacle spans one otherwise-unoccupied horizontal or vertical two-cell route. Short or branching horizontal routes use red and blue barriers; yellow is included when the second cell continues straight without a perpendicular bypass. Vertical gates are selected only in straight north-south sections, use all three barriers, and place yellow above red. Horizontal barriers repeat the exported 4x6 Fiorwoods stamp with an explicit 16px grass column between stamps. Vertical barriers repeat the export-67 6x3 stamp with an explicit 16px grass row between stamps.
- Every colored gate has exactly two physical plates, one on each side. A plate affects only its nearest gate; either plate holds that gate open, enabling two players to relay one another through the chain.
- Plate occupancy is role-agnostic and server-authoritative. Wardens can also press `E` near an unlatched plate to open that colored gate for the shared five-second timed cycle. Pressed and latched state replicates with `plateActivated`; disconnected players are inert and do not hold a gate open.
- Each barrier repeats the exact half-scale `statuePillars_* 6` editor composition. Opening plays the color-matched `10, 11, 12, 13` sinking frames and closing reverses through the sequence back to frame `6`.
- Pillar sprites participate individually in entity Y-sorting at their bottom pixel, matching the central-hub pillars. Players below a pillar draw in front of it, while players above it draw behind it.
- Releasing the last plate restores the authoritative collider immediately, independently of the closing animation. A player overlapping that collider is ejected to their recorded approach side; a player already stuck inside is pushed opposite their facing direction.

### Trap Cells and Cages

- Each generated room deterministically selects 6-10 well-spaced, obstacle-free 6x6 maze cells after all other objective and obstacle placement. Trap cells never overlap the hub, team spawns, gates, bridges, swamps, sword fields, treasure cells, or the portal platform.
- Only wardens render the translucent red in-world cell overlays and matching red minimap cells. A warden anywhere inside or just outside one sees a red `[ E ]` above their character.
- Activating one nearby trap cell atomically checks the whole trap network and cages every uncaged survivor whose feet are currently inside an available trap cell. Wardens are excluded server-side.
- A valid activation that captures nobody returns a private `no-survivors` or `release-cooldown` reason to the Warden. The client shows the reason in the bottom typewriter dialogue used by the role introduction and briefly shakes the red `[ E ]` prompt. If a newly materialized cage overlaps the activating Warden, the server moves them to the nearest collision-free side with a two-pixel gap.
- Cage state is server-authoritative and replicated through normal snapshots. The client materializes the supplied six-piece 48x32 dark-grass base below all entities, the `birdCage1` back layer below the player, and the `birdCage2` closed front layer above the player, then swaps the front to `birdCage3` when another nearby outside player opens it.
- Each captured survivor also receives an immediate private `PLAYER_TRAPPED` event so their client opens the bottom typewriter dialogue explaining that another player must release them.
- The prisoner cannot open their own cage, and another imprisoned player does not count as outside. Opening the gate starts a server-authoritative 10-second capture cooldown for that trap cell without disabling other cells. The prisoner may leave north or south; once clear, that cage becomes an empty permanent collider.
- If the same survivor is later captured again in the same trap cell, their previous cage in that cell disappears before the replacement cage materializes. Their cages in other trap cells and other players' cages are unaffected.

## Map System

Map generation lives in `packages/shared/src/maps/level1.ts`.

`generateMazeLayout()` returns the tile map, spawn points, gate, bridge, swamp, sword-field, spike-gate, decorated T-junction, decorated vertical-passage, trap-cell, and chest placements, and a visual-only `dirtMask` used by the client ground renderer and minimap. Each bridge placement includes its deterministic hidden safe-tile mask; mutable obstacle and cage state lives in `GameState`.

### Core Layout

- Tile grid: `218 x 218`
- Tile size: `16 x 16` pixels
- Cell graph: `15 x 15`
- Walkable room cell size: `6` tiles
- Wall band size between cells: `8` tiles
- Cell step: `14` tiles
- Central hub size: `30 x 30` tiles
- Hub entrances: `4` main connections to the maze (`north`, `east`, `south`, `west`)

### Generation Pipeline

1. Start from a solid wall-filled map.
2. Carve the central hub.
3. Mark overlapping hub cells as already visited in the cell graph.
4. Carve the remaining `15 x 15` maze with recursive backtracking.
5. Open the four hub entrances into the surrounding maze.
6. Post-process solid regions into the final 2.5D wall tile set.
7. Place the three non-solid runestone objective markers; the hub repaint, exact runestone positions, and colliders come from the authored central-hub layout.
8. Compute spawn points from the ungated maze, then stamp one closed gate cell per team along the chosen spawn-to-hub routes when a qualifying vertical (north-south) corridor cell exists. Horizontal passages never receive gates.
9. Stamp a visual-only dirt mask around each closed gate so the client can render short dirt approaches that transition back into grass.
10. Select up to 12 bridge passages across the whole maze, independently of spawn-to-hub routes. Each bridge connects two empty 6×6 cells, retains forest walls along its west and east banks, excludes spawn/hub/gate cells, and never shares either adjacent cell with another bridge.
11. Assign every bridge a distinct deterministic hidden route through its 2×6 central-stone walkway. The permanent stair tiles at both ends are outside the puzzle. Routes have one safe tile at each endpoint and one or two non-adjacent rows where the route crosses between columns.
12. Exclude actual safe player spawn cells, identify every dead end in all four orientations, deterministically select 60% of the eligible cells, then attach each cell's weighted one-, two-, or three-chest direction-mapped prefab. Portal placement excludes those reserved cells.
13. After portal and sword-field placement, select 3-6 deterministic horizontal or vertical passages for spike-gate chains, excluding every reserved objective and authored obstacle cell. Horizontal routes use two barriers in short or branching sections and add yellow in a continuing bounded corridor; vertical routes are limited to straight north-south sections, receive first consideration so the rarer orientation appears when eligible, and use yellow in the open slot above red. Then choose 6-10 deterministic trap cells from the remaining complete 6x6 walkable cells, preferring at least one cell of spacing between highlights.
14. From the remaining north-closed E/S/W and south-closed N/E/W T-junctions, deterministically select up to 85% for the matching authored stone-ruin, signpost, and vegetation decoration, always selecting at least one whenever a compatible footprint exists. Each prefab reserves its center, west, east, and open vertical cell and is skipped when any is occupied by an objective, solid authored obstacle, spawn, hub, portal platform, or another selected prefab; floor-only trap cells may overlap it.
15. Deterministically decorate 16% of the remaining open north-south cell boundaries, always selecting at least one when a compatible pair exists. Each exact style-editor (22) prefab reserves both adjacent 6x6 cells and cannot overlap any other generated cell occupant, trap, or decorated T-junction footprint.

### Spawns and Objective Placement

- Team spawn points are computed with BFS over the cell graph, not hardcoded coordinates.
- `SPAWN_DISTANCE` is currently `10` cell-steps from the hub.
- Spawn selection prefers angular separation around the map so teams begin in different sectors.
- Closed gates are chosen from vertical (north-south) corridor cells on spawn-to-hub paths and are rendered as one-tile-thick horizontal barriers through the middle of those cells.
- Each gate also produces a short rectangular dirt band in shared layout data. The dirt mask is visual-only and does not affect collision or navigation.
- Bridge selection is deterministic per maze seed and is intentionally global rather than restricted to squad routes.
- Bridge puzzle state is shared by the room. A wrong step removes both columns strictly ahead of the player; on the terminal row, only that row falls and the player returns to the preceding row. Every walkway stone keeps its authored south-facing front sprite attached below neighboring stone tops, so the face follows falling, rising, and magical hovering while ordinary bridge structure occludes it. Each intact row also retains a lower-sorted shadow: two stones use the full 32px span, one partially restored stone uses the aligned 16px half, and stones in the row ahead naturally occlude the overlapping part. Freshly entering either authored treasure circle starts a server-authoritative ten-second channel: progress pauses when the channeling player leaves and can resume from either circle. Missing stones rise back one at a time and hover subtly, remaining blocked until the repair completes; stones that never fell stay normal and walkable throughout.
- Portal placement is also BFS-driven, prefers cells deeper in the maze than player spawns, and excludes both cells reserved by every bridge.

### Tile IDs

| Id   | Constant               | Meaning                                                   |
| ---- | ---------------------- | --------------------------------------------------------- |
| `0`  | `TILE_FLOOR`           | Main walkable floor                                       |
| `1`  | `TILE_FLOOR_SHADOW`    | Walkable floor shadow / dirt variation                    |
| `2`  | `TILE_WALL_FACE`       | South-facing wall face                                    |
| `3`  | `TILE_WALL_TOP`        | Bright grassy wall cap                                    |
| `4`  | `TILE_WALL_INTERIOR`   | Solid cliff interior                                      |
| `5`  | `TILE_WALL_SIDE_LEFT`  | Left cliff side                                           |
| `6`  | `TILE_WALL_SIDE_RIGHT` | Right cliff side                                          |
| `7`  | `TILE_WALL_BOTTOM`     | Bottom cliff edge                                         |
| `8`  | `TILE_WALL_CORNER_TL`  | Top-left outer corner                                     |
| `9`  | `TILE_WALL_CORNER_TR`  | Top-right outer corner                                    |
| `10` | `TILE_WALL_CORNER_BL`  | Bottom-left outer corner                                  |
| `11` | `TILE_WALL_CORNER_BR`  | Bottom-right outer corner                                 |
| `12` | `TILE_WALL_TOP_EDGE`   | Top exposed rock edge                                     |
| `13` | `TILE_TREE`            | Reserved decorative tree marker (not currently generated) |
| `14` | `TILE_RUNESTONE_1`     | Runestone type 1                                          |
| `15` | `TILE_RUNESTONE_2`     | Runestone type 2                                          |
| `16` | `TILE_RUNESTONE_3`     | Runestone type 3                                          |
| `17` | `TILE_GATE_HORIZONTAL` | Closed gate row across a cell midpoint                    |
| `18` | `TILE_GATE_VERTICAL`   | Closed gate column across a cell midpoint                 |

## Client Rendering and HUD

### Frontend Navigation and Startup Boundary

The client first runs a lightweight DOM app shell with these states:

1. restore the persisted Supabase session;
2. show Google authentication and a local guest option when signed out;
3. ask a new guest to choose a display name, or restore the current tab's
   existing guest profile;
4. load or create the signed-in user's `public.profiles` row and require a new
   account to choose its display name once;
5. show Main Menu, Join by Code, Tutorial, Profile, or the server-backed Admin
   menu for an active administrator; suspended accounts instead receive a
   blocked-account screen with Sign Out and Check Again;
6. after Main Menu renders, lazily import PixiJS and prime the runtime texture
   cache during idle menu time; one generated environment atlas, one character
   atlas, and the two pixel fonts load eagerly so a cold cache does not create a
   category-by-category waterfall;
7. after Quick Play, Create Private Game, or Join Room is selected, initialize
   the Pixi application and start the authoritative waiting-room connection,
   reusing any warmed assets and showing the DOM lobby overlay as soon as
   admission succeeds; and
8. show **Game is starting…** for every player when the server locks the roster,
   build the maze after `ROOM_JOINED`, send `GAME_READY`, and keep the loading
   screen visible until the server releases the fully ready roster with
   `MATCH_STARTED`.

The Main Menu tutorial is the one intentional non-network round. It creates a
single-survivor browser-local session and reuses the production maze renderer,
collision, character, central hub, runestone, wisdom-orb, and portal systems.
Its compact authored route uses normal maze cells: a northbound spawn corridor,
a decorated north-closed T-junction, the central hub through only its western
entrance, and an extended western branch that turns north, crosses a production
bridge obstacle, and ends at a portal dead end. A southbound side branch from
the first western cell contains a scripted Male2 Warden, two already-caged
survivors positioned near the cell's southern edge who warn an entering player,
and a real trap-cell capture after the
player crosses two tiles into the dead end. After the capture exchange, the
Warden returns north and disappears upon entering the preceding cell. Two
seconds later, a third scripted survivor enters from the north, approaches and
opens the two NPC cages in order, then opens the player's cage last. Each freed
NPC uses cage-aware local pathing to walk north around any blocking cage and
disappears in the preceding cell. Two runestones start
active. The tutorial has no waiting lobby, WebSocket, match
timer, player chat, or remote players, and returns to the Main Menu after the
survivor escapes. Activating the final rune snaps the tutorial camera to the
portal for its activation, then snaps back to the player for the escape
instruction. Verified admins keep
the in-game admin panel in this local session; its state-changing actions are
handled by the browser-local authority instead of a room server.

Both Main Menu tutorials and first-time training while queued create one
analytics attempt when the local session starts. The client sends a heartbeat
every thirty seconds, completes the attempt on portal escape, and reports
explicit exits or page unloads without blocking navigation. When an admin
report is read, an in-progress attempt with no heartbeat for ten minutes is
closed at its last activity time. Completed queued attempts retain their update
credential across the lobby reload so opening the reminder choices and clicking
Discord or Google Calendar are attributed to the same attempt.

Guest profiles are created only after the naming form is submitted, use
`sessionStorage`, never call Supabase, and are discarded
when the guest leaves the session or closes the browser tab. They support the
same local display-name and HTTPS avatar validation as authenticated profiles.
Authenticated profiles persist completion in `display_name_chosen`; migrations
mark pre-existing profiles complete, while newly created profiles receive an
empty naming form before the menu or an invited lobby can open.

Auth and display-name screens retain the lightweight DOM-only path. After Main
Menu first renders, a delayed warmup imports the game module and starts the
four-file runtime asset request, but it does not create a Pixi application or
canvas, construct `NetworkManager`, or open a WebSocket. The selected Quick
Play/private-room connection begins inside `startGame()` and uses the profile
display name. Any remaining asset progress continues in the background while
the player can vote, chat, and inspect the lobby. If a countdown completes first,
the client restores the loading screen, retains the latest authoritative match
snapshot and match events, and applies them after asset loading finishes. It
does not expose the maze or begin local input until every client is ready and
the server broadcasts `MATCH_STARTED`. Each
occupied seat has a private 256-bit bearer token in
the current tab's `sessionStorage`, scoped to the current profile ID. After
identity restoration, a reload automatically resumes that seat; a different
explicit `?room=CODE` invitation clears the stored seat and connects directly
to the invited room's lobby instead. The client consumes the `room` query
parameter before connecting so leaving the lobby does not trigger another join;
the reconnect session retains the room ID for genuine reload recovery.

See `docs/SUPABASE_SETUP.md` for the migration, Google provider, redirect URL,
and environment configuration.

### Rendering Structure

- The client renders to an internal resolution of `480 x 270`.
- Integer scaling is used when the viewport can fit at least `1x`; narrower screens fall back to fractional downscaling so the full canvas remains visible.
- The main Pixi stage contains:
  - a world container for the map and world entities
  - sorted entity layers for players and tall objects
  - screen-space HUD overlays plus a DOM-based mobile controls overlay

### Camera and World Presentation

- The camera follows the local player by feet position.
- A short portal-reveal cinematic temporarily overrides the camera target.
- Screen shake is used when the portal appears.
- The tilemap renderer performs viewport culling for better performance on the large map.

### Asset Loading and Fallbacks

Asset loading lives in `packages/client/src/assets/AssetLoader.ts`. The
deterministic `scripts/build-runtime-atlas.py` generator packs all 455 eagerly
used environment, obstacle, UI, and nested-sheet PNG paths into
`assets/runtime/runtime-atlas.png`. Pixel-identical sources share one frame,
and every unique frame receives an extruded edge plus a transparent guard pixel
to prevent texture bleeding. `RuntimeTextureAtlas.ts` exposes the original
asset paths as Pixi texture views, so layouts retain their existing path keys
and loading remains eager. The separately generated character atlas retains
all 612 animation frames; together, the two atlases replace 456 individual PNG
requests with two.

Production builds run the dependency-free Node verifier in
`scripts/verify-runtime-atlas.mjs`; it checks source, atlas, and dimension
digests without requiring Pillow on the deployment image. The Python generator
remains the source of truth for rebuilding the committed atlas, and
`verify:runtime-atlas:exact` performs its byte-for-byte local verification.

The loader attempts to load atlas-backed authored PNG assets first, falls back
to their individual source URLs if the generated atlas is unavailable, and
retains generated texture fallbacks for core art. Nested legacy sheets remain
addressable inside the environment atlas: `assets/tiles.png` is a `272 x 32`
sheet whose row 0 contains the existing floor, wall, and grass slices, while
row 1 columns `0..9` contain the dirt transition set used for gate approaches.
Current supported source assets include:

- `assets/tiles.png`
- `assets/oak-tree.png`
- `assets/gates.png`
- `assets/shadow_top.png`
- `assets/shadow_left.png`
- `assets/shadow_corner.png`
- `assets/player_0.png`
- `assets/player_1.png`
- `assets/player_2.png`
- `assets/runestones.png`
- `assets/portal_spritesheet.png`
- `assets/portal-platform/` (the authored Tormund masonry modules used by the portal stairs and platform)
- `assets/chest-dead-end/chest01_0.png`
- `assets/chest-dead-end/chest01_16.png`
- `assets/chest-dead-end/goldflowers_9.png`
- `assets/bridge-obstacle/Sprite_Ancient_Ruins_106_front.png`
- `assets/bridge-obstacle/Sprite_Ancient_Ruins_106_front_shadow.png`
- `assets/wisdom_orb.png`
- `assets/expand_button.png`
- `assets/contract_button.png`
- Pixel Operator font files

Fallback texture generation lives in `packages/client/src/assets/FallbackTextures.ts`.

### HUD and World-Space UI

The client currently has multiple UI subsystems, not just the minimap:

- `Minimap`
  - screen-space HUD in the bottom-right corner
  - player-centered exploration view with fog of war
  - supports portal display from the beginning of the match
  - renders the local player as one yellow pixel and other connected players as contrasting cyan pixels in both compact and expanded views
  - renders each revealed treasure dead end as a small chest glyph; wardens see every chest on the expanded whole-maze view
  - renders every revealed sword field as three downward-pointing sword glyphs; wardens see every field on the expanded whole-maze view
  - renders every revealed spike-gate barrier as an alternating steel spike strip aligned with the corridor; wardens see every barrier on the expanded whole-maze view
  - wardens receive a solid red frame with no fog-of-war and a wooden corner expand button; the fixed whole-maze view is scaled to fit the internal screen, marks the portal and the local warden's position, and provides a matching contract button
- `WisdomOrbHud`
  - screen-space HUD in the top-left corner
  - survivors see one icon per owned orb plus the current remaining count, capped at three; wardens do not receive this HUD
  - filled orbs are clickable
- `IntroDialogueHud`
  - screen-space dialogue panel centered along the bottom of the screen
  - shows a two-step intro dialogue when the local player joins the maze
  - reveals each page with a typewriter effect
  - `E` or the clickable arrow skips the current typing animation first, then advances or dismisses
- `MobileControls`
  - mobile-only DOM overlay shown on coarse-pointer, non-hover devices
  - bottom-left D-pad for `west`, `north`, `east`, and `south`
  - right-side `E` and `Q` buttons that mirror the keyboard action keys
- `ProximityChatHud`
  - DOM overlay aligned to the bottom-left of the scaled Pixi canvas
  - opens with `Enter`, `T`, or its clickable prompt and uses a native single-line input on mobile
  - pauses gameplay input while typing, shows a live remaining-character counter, and colors sender names by their public squad assignment
  - retains ordinary 10-tile routing except that a verified admin with debug tools enabled receives every message and sends messages to the full room
- `GameMenuHud`
  - Pixi overlay matching the end-of-match panel, with Resume, Controls, and a confirmed Exit Match flow
  - freezes only the local client's input; the authoritative multiplayer match clock and other players continue
- `WisdomArrow`
  - local-only world-space hint arrow above the local player
  - appears after a successful orb use
  - follows the player briefly while keeping the server-returned direction fixed
- Player name tags
  - remote-only world-space labels positioned just below each character
  - project world positions into a dedicated screen-space overlay above all world objects
  - retain a fixed crisp screen size through camera zoom so scenery cannot cover or distort them
  - use the replicated `PlayerInfo.displayName`; the local player's own label is hidden
- Runestone/chest interaction prompt
  - world-space `[E]` prompt shown above nearby eligible inactive runestones, unopened treasure chests, or unlatched normal/spike gate buttons for wardens
  - switches to `[ Q ]` at either entrance of a blocking sword field for survivors carrying an orb
  - wardens see a red `[ E ]` at blocking sword-field entrances and can clear them without an orb
  - the prompt is white for survivors and red for wardens across all supported interactions

### Input Handling

- Movement: arrow keys or `WASD`, plus the mobile D-pad on supported touch devices
- Proximity chat: `Enter`, `T`, or click `[Enter] To Chat`; `Enter` sends, while empty `Enter`, `Escape`, or clicking outside closes the input
- All movement, interaction, wisdom, and mobile controls are suppressed while chat owns keyboard focus
- Game menu: `Escape` or the screen-space menu button opens it; `Escape` backs out of Controls/Exit confirmation, then resumes. Movement, chat, interactions, wisdom, mobile input, and debug canvas actions are suppressed while it is open.
- Confirming Exit Match sends `LEAVE_ROOM`, releases the reconnect seat immediately, clears its tab credential, and returns to the main menu.
- Intro dialogue advance: `E`, the clickable arrow button, or the mobile `E` button while the intro dialogue is visible
- Intro dialogue skip: `E`, the clickable arrow button, or the mobile `E` button while the current page is still typing
- Runestone interaction: `E` or the mobile `E` button after the intro dialogue is dismissed
- Chest interaction: `E` or the mobile `E` button while near an unopened chest; survivors must carry fewer than three wisdom orbs, while wardens destroy the chest without a reward
- Gate-button interaction: wardens can press `E` or the mobile `E` button near an unlatched normal-gate button or spike-gate plate to latch it until that gate's next timed reset
- Wisdom orb use: `Q`, the mobile `Q` button, or click a filled orb in the HUD
- Sword-field clear: survivors use the wisdom-orb controls while `[ Q ]` is visible; wardens use `E` or the mobile `E` button while their red `[ E ]` is visible
- Warden map: click the red minimap to open; click the map/backdrop or press `Escape` to close. Movement remains active while it is open so the local position marker can be used for navigation, while interaction and wisdom actions remain suppressed.
- Server-verified admins can open the in-game admin panel from the game menu. One default-on setting enables scroll zoom, zoom toggling, click teleport, the top-left Tick/Pending/Snaps HUD, and admin-global in-match chat: the admin receives every player message and their own messages reach the full room. Cell boundaries remain local. A separate default-off room setting broadcasts the stats HUD to every participant, including guests, only while the match is running and never in the lobby. The panel can also replace the authoritative running-match timer using minute/second inputs; setting it to zero immediately resolves a Warden timeout win.
- The admin player menu privately fetches a selected player's current role and can authoritatively change it. The server updates that seat and privately rebuilds the affected player's role-specific HUD and inventory.

## Monorepo Structure

### Shared Package

- `packages/shared/src/index.ts`
  - shared constants, protocol types, and re-exports
- `packages/shared/src/admin.ts`
  - typed Admin API pages, room snapshots, user records, round details, audit entries, and Community Round schedule
- `packages/shared/src/lobby.ts`
  - lobby limits, room-code validation, voting thresholds, role counts, and public state contracts
- `packages/shared/src/physics.ts`
  - movement and collision helpers used by both client and server
- `packages/shared/src/maps/level1.ts`
  - procedural labyrinth generation, gated layout stamping, spawn selection, portal placement
- `packages/shared/src/navigation.ts`
  - hub-distance fields and wisdom-orb guidance
- `packages/shared/src/sword-field.ts`
  - authored colliders, entrance targeting, and replicated sword-field state

### Server Package

- `packages/server/src/index.ts`
  - WebSocket/HTTP server bootstrap and protocol routing
- `packages/server/src/adminApi.ts` / `adminService.ts`
  - bearer-authenticated administrator routes, tutorial reports, the public schedule read, protected Supabase queries, and mutations
- `packages/server/src/tutorialApi.ts` / `tutorialService.ts`
  - non-blocking authenticated/guest tutorial lifecycle ingestion and protected persistence
- `packages/server/src/Room.ts`
  - room lifecycle, hidden role seats/private inventories, authoritative state, tick loop, runestone logic, portal activation, wisdom-orb handling

### Client Package

- `packages/client/src/main.ts`
  - Supabase and guest session restoration plus Auth/Main Menu/Profile/Admin DOM navigation
- `packages/client/src/admin/`
  - protected Admin API client and responsive user/round/activity/schedule console
- `packages/client/src/navigation/AppShellRoute.ts`
  - canonical `/admin` route recognition and session-refresh view preservation
- `packages/client/src/auth/supabase.ts`
  - browser-safe Supabase configuration, OAuth helpers, profile loading, validation, and updates
- `packages/client/src/auth/guest.ts`
  - tab-local guest profile creation, restoration, validation, and updates
- `packages/client/src/game.ts`
  - lazy Pixi app bootstrap, network entry, input, prediction, reconciliation, interpolation, camera, HUD orchestration
- `packages/client/src/systems/TutorialTelemetry.ts`
  - tutorial start/heartbeat/outcome tracking, unload recovery, and queued reminder attribution
- `packages/client/src/net/NetworkManager.ts`
  - client WebSocket wrapper, reconnect backoff, and message dispatch
- `packages/client/src/net/ReconnectSession.ts`
  - profile-scoped tab storage for private seat tokens and reconnect deadlines
- `packages/client/src/net/SnapshotBuffer.ts`
  - buffered snapshots for remote interpolation
- `packages/client/src/assets/AssetLoader.ts`
  - runtime asset loading with fallback support
- `packages/client/src/systems/TilemapRenderer.ts`
  - chunked tilemap rendering, world decorations, runestone sprites
- `packages/client/src/systems/Portal.ts`
  - animated portal world entity
- `packages/client/src/systems/PortalPlatform.ts`
  - authored portal clearing, raised stone platform, and stairs
- `packages/client/src/systems/Minimap.ts`
  - minimap HUD
- `packages/client/src/systems/WisdomOrbHud.ts`
  - top-left orb HUD and click handling
- `packages/client/src/systems/IntroDialogueHud.ts`
  - bottom-screen paged spawn dialogue HUD
- `packages/client/src/systems/MobileControls.ts`
  - DOM overlay for mobile touch movement and `E`-equivalent interaction
- `packages/client/src/systems/GameMenuHud.ts`
  - local in-match menu, controls reference, and confirmed explicit-leave action
- `packages/client/src/systems/ProximityChatHud.ts`
  - canvas-aligned DOM proximity-chat log, input, timer, and character counter
- `packages/client/src/systems/LobbyOverlay.ts`
  - responsive waiting-room roster, room code/share link, countdown, vote controls, and room-wide chat
- `packages/client/src/systems/ReconnectOverlay.ts`
  - blocking reconnect progress, estimated grace countdown, and Return to Menu action
- `packages/client/src/systems/WisdomArrow.ts`
  - temporary world-space guidance arrow

## Package Dependency Graph

```text
@labyrinth/shared
    ^
    |
    +-- @labyrinth/server
    |
    +-- @labyrinth/client
```

- `@labyrinth/shared` has no runtime dependency on client or server code.
- `@labyrinth/server` and `@labyrinth/client` both depend on shared gameplay code so simulation rules stay aligned.

## Development Workflow

### Install

```bash
npm install
```

### Run the Server

```bash
npm run dev -w packages/server
```

### Run the Client

```bash
npm run dev -w packages/client
```

### Typecheck

```bash
npm run typecheck -w packages/shared
npm run typecheck -w packages/server
npm run typecheck -w packages/client
```

### Lint

```bash
npm run lint
```

This document should be updated whenever the shared protocol, procedural map layout, core HUD systems, or authoritative gameplay flow changes.
