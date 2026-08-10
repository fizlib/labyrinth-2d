# Labyrinth 2D Architecture

Last updated: 2026-08-10 - Warden trap cells and survivor cages

## Project Overview

Labyrinth 2D is a multiplayer top-down pixel-art labyrinth game built as a TypeScript monorepo with three workspace packages:

- `packages/shared`: shared constants, protocol types, procedural map generation, navigation, and collision.
- `packages/server`: the authoritative multiplayer simulation and room management.
- `packages/client`: the authenticated DOM app shell plus the lazy PixiJS renderer, client prediction, interpolation, HUD, and input handling.

Supabase provides browser authentication and owner-private profile storage. It
does not participate in the authoritative simulation or WebSocket protocol.

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

1. A client connects and sends `JOIN_ROOM`.
2. The server creates or reuses the room and assigns the player to the first free stable seat. Each room preselects two warden seats in different teams; all other seats are survivors.
3. The room generates one gated maze layout from a random seed and derives team spawn points from the ungated base maze.
4. The room starts its fixed tick loop when the first player joins.
5. The room stops and is destroyed when the last player leaves.

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

| Message | Purpose |
| --- | --- |
| `JOIN_ROOM` | Join or create a room with a display name |
| `PLAYER_INPUT` | Send one frame of movement intent plus `sequenceNumber` |
| `ACTIVATE_RUNESTONE` | Request activation of a nearby runestone |
| `OPEN_CHEST` | Request opening a nearby unopened treasure chest |
| `PRESS_PRESSURE_PLATE` | Warden-only request to latch a nearby gate button |
| `ACTIVATE_TRAP_CELL` | Warden-only request to fire the shared trap network from a nearby 6x6 trap cell |
| `OPEN_CAGE` | Outside-player request to open a nearby prisoner's cage |
| `USE_WISDOM_ORB` | Survivors spend an orb on a nearby reveal/clear or request direction; wardens may use the same proximity request only to clear sword fields |
| `DEBUG_TELEPORT` | Debug-only teleport helper used by developer tooling |

#### Server -> Client

| Message | Purpose |
| --- | --- |
| `ROOM_JOINED` | Initial join payload with `playerId`, `mapSeed`, full `gameState`, and the recipient's private role/orb inventory |
| `TICK_UPDATE` | Authoritative room snapshot broadcast every server tick |
| `PLAYER_LEFT` | Notify clients that one player disconnected |
| `RUNESTONE_ACTIVATED` | Broadcast that one runestone is now active |
| `ALL_RUNESTONES_ACTIVATED` | Broadcast the existing portal coordinates once all runestones are active |
| `CHEST_OPENED` | Broadcast a chest's shared opened state and opener |
| `WISDOM_ORB_GRANTED` | Privately provide a rewarded survivor's post-reward orb count; wardens receive no reward message |
| `WISDOM_ORB_USED` | Private accepted-action response containing the result and remaining orb count; warden sword clears leave the count at zero |
| `PLAYER_ROLE_CHANGED` | Private debug response that replaces the recipient's role and orb inventory |
| `DEBUG_PLAYER_ROLE` | Private debug response containing a selected player's authoritative role |
| `TRAP_ACTIVATION_RESULT` | Private result used for the activating Warden's empty-room feedback |
| `ERROR` | Report room-join or protocol errors |

### Shared State Contracts

#### `PlayerInfo`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Server-generated player id |
| `displayName` | `string` | Client-provided display name |
| `teamId` | `number` | Team assignment used for spawn grouping |
| `spriteIndex` | `number` | Client sprite-sheet selection |
| `x`, `y` | `number` | Bottom-center feet position in world pixels |
| `facing` | `'up' \| 'down' \| 'left' \| 'right'` | Authoritative sprite facing |
| `isMoving` | `boolean` | Current movement animation state |
| `lastProcessedInput` | `number` | Highest acknowledged local input sequence |

Roles and wisdom-orb inventories are intentionally absent from `PlayerInfo` and public snapshots. `ROOM_JOINED` privately provides the recipient's `role` (`'survivor' | 'warden'`) and starting `wisdomOrbs`; later orb changes use the private `WISDOM_ORB_USED` response.

#### `RunestoneInfo`

| Field | Type | Notes |
| --- | --- | --- |
| `index` | `number` | Runestone slot `0`, `1`, or `2` |
| `tileX`, `tileY` | `number` | Tile coordinates inside the generated map |
| `activated` | `boolean` | Authoritative activation state |

#### `GameState`

| Field | Type | Notes |
| --- | --- | --- |
| `tick` | `number` | Authoritative simulation tick counter |
| `players` | `PlayerInfo[]` | All connected players in the room |
| `runestones` | `RunestoneInfo[]` | Three runestones with activation state |
| `portal` | `{ x: number; y: number } \| null` | Portal world position in pixels, normally selected during room creation |
| `bridgeStates` | `BridgeState[]` | Authoritative missing-stone mask for every generated bridge |
| `chestStates` | `ChestState[]` | Authoritative opened/unopened state for every generated treasure chest |
| `swordFieldStates` | `SwordFieldState[]` | Authoritative blocking, lowering, and cleared state for every generated sword field |
| `gateStates` | `GateState[]` | Authoritative open/closed state for every generated gate |
| `pressurePlateStates` | `PressurePlateState[]` | Authoritative physical-press and warden-latch state for every gate button |
| `cageStates` | `CageState[]` | Authoritative spawned, opened, and permanently vacated cage state |

## Shared Gameplay Systems

### Collision and Movement

- Shared movement constants and collision helpers live in `packages/shared/src/physics.ts`.
- Both client and server use the same feet-based collision logic.
- Player position is stored at the feet, not the sprite center, which keeps wall contact and sorting consistent.
- Closed gate tiles are solid map obstacles, so both client prediction and server simulation block on them automatically.
- Physical button occupancy treats wardens and survivors identically: two distinct players on the spawn-side buttons or one player on the hub-side button hold the gate open only while that physical requirement remains satisfied.
- Wardens can separately latch nearby buttons with `E`; when a latch completes one side's button requirement, the gate opens for five seconds, resets every associated button, and requires occupied buttons to be released before another activation cycle.
- Bridge obstacles use the same six authored rectangle/right-triangle bank colliders on the client and server. Their two-tile-wide spans also share dynamic collision masks so fallen stones expose impassable water consistently during prediction and authoritative simulation.
- Directional treasure dead ends use the same authored rectangle colliders on the client and server for their tree backing, rock, and every count-specific chest position.
- Sword fields preserve the ten small fence/marker colliders from the first editor export. The additional `149×32` central blocker from the second export remains solid through the shake-and-sink sequence and is removed only when the server marks the field cleared.
- Spawned cages use the shared dynamic-collider path and the editor-authored 18x14 base collider. Closed prisoners cannot change position, but their movement input still drives replicated facing and walk animation; opened prisoners may move only north/south until clear, while every other player collides with the cage. A vacated cage remains permanently solid.
- Collision respects the portal from the beginning of the match. Its authored wall cutout opens four tiles of walkable platform behind the arch, while mirrored rectangle and right-triangle edge colliders keep players inside the masonry and leave the central stairs open.

### Runestones and Portal Flow

- The generated map contains exactly three runestone tiles inside the hub area.
- The server validates runestone activation by proximity before accepting a request.
- During room creation, the server computes one portal position farther from the hub than player spawns. It is centered at the wall between two vertically adjacent 6×6 cells, and both cells must retain their north forest walls.
- When all three runestones are active, the server broadcasts the existing portal position and the client plays its light-up animation.
- Wisdom orbs switch from hub guidance to portal guidance only after the portal is activated.
- The portal is a world entity, not a tilemap tile.

### Hidden Roles and Wisdom Orbs

- A full room has `7` survivors and `2` wardens. The wardens occupy different teams, and a stable team-seat assignment preserves that distribution when a disconnected player is replaced.
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
- Survivors with an orb see `[ Q ]` at either still-blocked entrance. Keyboard `Q`, mobile `Q`, and clicking the orb HUD all use the same server-validated request.
- Wardens instead see a red `[ E ]` and may clear any number of encountered fields with keyboard/mobile `E`; they spend no orb.
- The server consumes one orb only for survivors, records the lowering start tick, keeps the main collider active for the full animation, then marks the field cleared. Late joiners reconstruct the correct visual phase from the current server tick.
- Fence, grave, and ground art remain after all forty-one swords disappear, matching the supplied editor layout.

### Trap Cells and Cages

- Each generated room deterministically selects 6-10 well-spaced, obstacle-free 6x6 maze cells after all other objective and obstacle placement. Trap cells never overlap the hub, team spawns, gates, bridges, swamps, sword fields, treasure cells, or the portal platform.
- Only wardens render the translucent red in-world cell overlays and matching red minimap cells. A warden anywhere inside or just outside one sees a red `[ E ]` above their character.
- Activating one nearby trap cell atomically checks the whole trap network and cages every uncaged survivor whose feet are currently inside any trap cell.
- A valid activation that finds no uncaged survivors returns private feedback to the Warden and briefly shakes the red `[ E ]` prompt. If a newly materialized cage overlaps the activating Warden, the server moves them to the nearest collision-free side with a two-pixel gap.
- Cage state is server-authoritative and replicated through normal snapshots. The client materializes the supplied six-piece 48x32 dark-grass base below all entities, the `birdCage1` back layer below the player, and the `birdCage2` closed front layer above the player, then swaps the front to `birdCage3` when another nearby outside player opens it.
- The prisoner cannot open their own cage, and another imprisoned player does not count as outside. After the gate opens, the prisoner may leave north or south; once clear, that cage becomes an empty permanent collider.
- If the same survivor is later captured again in the same trap cell, their previous cage in that cell disappears before the replacement cage materializes. Their cages in other trap cells and other players' cages are unaffected.

## Map System

Map generation lives in `packages/shared/src/maps/level1.ts`.

`generateMazeLayout()` returns the tile map, spawn points, gate, bridge, swamp, sword-field, trap-cell, and chest placements, and a visual-only `dirtMask` used by the client ground renderer and minimap. Each bridge placement includes its deterministic hidden safe-tile mask; mutable obstacle and cage state lives in `GameState`.

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
7. Place the hub tree and the three runestones.
8. Compute spawn points from the ungated maze, then stamp one closed gate cell per team along the chosen spawn-to-hub routes when a qualifying vertical (north-south) corridor cell exists. Horizontal passages never receive gates.
9. Stamp a visual-only dirt mask around each closed gate so the client can render short dirt approaches that transition back into grass.
10. Select up to 12 bridge passages across the whole maze, independently of spawn-to-hub routes. Each bridge connects two empty 6×6 cells, retains forest walls along its west and east banks, excludes spawn/hub/gate cells, and never shares either adjacent cell with another bridge.
11. Assign every bridge a distinct deterministic hidden route through its 2×6 central-stone walkway. The permanent stair tiles at both ends are outside the puzzle. Routes have one safe tile at each endpoint and one or two non-adjacent rows where the route crosses between columns.
12. Exclude actual safe player spawn cells, identify every dead end in all four orientations, deterministically select 60% of the eligible cells, then attach each cell's weighted one-, two-, or three-chest direction-mapped prefab. Portal placement excludes those reserved cells.
13. After portal and sword-field placement, choose 6-10 deterministic trap cells from the remaining complete 6x6 walkable cells, preferring at least one cell of spacing between highlights.

### Spawns and Objective Placement

- Team spawn points are computed with BFS over the cell graph, not hardcoded coordinates.
- `SPAWN_DISTANCE` is currently `10` cell-steps from the hub.
- Spawn selection prefers angular separation around the map so teams begin in different sectors.
- Closed gates are chosen from vertical (north-south) corridor cells on spawn-to-hub paths and are rendered as one-tile-thick horizontal barriers through the middle of those cells.
- Each gate also produces a short rectangular dirt band in shared layout data. The dirt mask is visual-only and does not affect collision or navigation.
- Bridge selection is deterministic per maze seed and is intentionally global rather than restricted to squad routes.
- Bridge puzzle state is shared by the room. A wrong step removes both columns strictly ahead of the player; on the terminal row, only that row falls and the player returns to the preceding row. Freshly entering either authored treasure circle starts a server-authoritative ten-second channel: progress pauses when the channeling player leaves and can resume from either circle. Missing stones rise back one at a time and hover subtly, remaining blocked until the repair completes; stones that never fell stay normal and walkable throughout.
- Portal placement is also BFS-driven, prefers cells deeper in the maze than player spawns, and excludes both cells reserved by every bridge.

### Tile IDs

| Id | Constant | Meaning |
| --- | --- | --- |
| `0` | `TILE_FLOOR` | Main walkable floor |
| `1` | `TILE_FLOOR_SHADOW` | Walkable floor shadow / dirt variation |
| `2` | `TILE_WALL_FACE` | South-facing wall face |
| `3` | `TILE_WALL_TOP` | Bright grassy wall cap |
| `4` | `TILE_WALL_INTERIOR` | Solid cliff interior |
| `5` | `TILE_WALL_SIDE_LEFT` | Left cliff side |
| `6` | `TILE_WALL_SIDE_RIGHT` | Right cliff side |
| `7` | `TILE_WALL_BOTTOM` | Bottom cliff edge |
| `8` | `TILE_WALL_CORNER_TL` | Top-left outer corner |
| `9` | `TILE_WALL_CORNER_TR` | Top-right outer corner |
| `10` | `TILE_WALL_CORNER_BL` | Bottom-left outer corner |
| `11` | `TILE_WALL_CORNER_BR` | Bottom-right outer corner |
| `12` | `TILE_WALL_TOP_EDGE` | Top exposed rock edge |
| `13` | `TILE_TREE` | Hub tree |
| `14` | `TILE_RUNESTONE_1` | Runestone type 1 |
| `15` | `TILE_RUNESTONE_2` | Runestone type 2 |
| `16` | `TILE_RUNESTONE_3` | Runestone type 3 |
| `17` | `TILE_GATE_HORIZONTAL` | Closed gate row across a cell midpoint |
| `18` | `TILE_GATE_VERTICAL` | Closed gate column across a cell midpoint |

## Client Rendering and HUD

### Frontend Navigation and Startup Boundary

The client first runs a lightweight DOM app shell with these states:

1. restore the persisted Supabase session;
2. show Google authentication and a local guest option when signed out;
3. load or create the signed-in user's `public.profiles` row, or restore the
   current tab's guest profile;
4. show Main Menu or Profile; and
5. dynamically import and start the PixiJS game only after Create Game is
   selected.

Guest profiles use `sessionStorage`, never call Supabase, and are discarded
when the guest leaves the session or closes the browser tab. They support the
same local display-name and HTTPS avatar validation as authenticated profiles.

Auth, Main Menu, Profile, and the Join Game placeholder do not initialize Pixi,
load runtime game assets, construct `NetworkManager`, or open a WebSocket. The
existing default-room connection begins inside `startGame()` and uses the
profile display name. A reload always restores to Main Menu rather than
silently re-entering gameplay.

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

Asset loading lives in `packages/client/src/assets/AssetLoader.ts`.

The loader attempts to load authored PNG assets first and falls back to generated textures if a file is missing. `assets/tiles.png` is a `272 x 32` atlas: row 0 contains the existing floor, wall, and grass slices, and row 1 columns `0..9` contain the dirt transition set used for gate approaches. Current supported assets include:

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
  - renders each revealed treasure dead end as a small chest glyph; wardens see every chest on the expanded whole-maze view
  - renders every revealed sword field as three downward-pointing sword glyphs; wardens see every field on the expanded whole-maze view
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
- `WisdomArrow`
  - local-only world-space hint arrow above the local player
  - appears after a successful orb use
  - follows the player briefly while keeping the server-returned direction fixed
- Runestone/chest interaction prompt
  - world-space `[E]` prompt shown above nearby eligible inactive runestones, unopened treasure chests, or unlatched gate buttons for wardens
  - switches to `[ Q ]` at either entrance of a blocking sword field for survivors carrying an orb
  - wardens see a red `[ E ]` at blocking sword-field entrances and can clear them without an orb
  - the prompt is white for survivors and red for wardens across all supported interactions

### Input Handling

- Movement: arrow keys or `WASD`, plus the mobile D-pad on supported touch devices
- Intro dialogue advance: `E`, the clickable arrow button, or the mobile `E` button while the intro dialogue is visible
- Intro dialogue skip: `E`, the clickable arrow button, or the mobile `E` button while the current page is still typing
- Runestone interaction: `E` or the mobile `E` button after the intro dialogue is dismissed
- Chest interaction: `E` or the mobile `E` button while near an unopened chest; survivors must carry fewer than three wisdom orbs, while wardens destroy the chest without a reward
- Gate-button interaction: wardens can press `E` or the mobile `E` button near an unlatched button to latch it until that gate's next timed reset
- Wisdom orb use: `Q`, the mobile `Q` button, or click a filled orb in the HUD
- Sword-field clear: survivors use the wisdom-orb controls while `[ Q ]` is visible; wardens use `E` or the mobile `E` button while their red `[ E ]` is visible
- Warden map: click the red minimap to open; click the map/backdrop or press `Escape` to close. Movement remains active while it is open so the local position marker can be used for navigation, while interaction and wisdom actions remain suppressed.
- Debug-only tools can enable scroll zoom, zoom toggling, and click teleport
- The debug player menu privately fetches a selected player's current role and can authoritatively change it. The server updates that seat and privately rebuilds the affected player's role-specific HUD and inventory.

## Monorepo Structure

### Shared Package

- `packages/shared/src/index.ts`
  - shared constants, protocol types, and re-exports
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
  - WebSocket server bootstrap and protocol routing
- `packages/server/src/Room.ts`
  - room lifecycle, hidden role seats/private inventories, authoritative state, tick loop, runestone logic, portal activation, wisdom-orb handling

### Client Package

- `packages/client/src/main.ts`
  - Supabase and guest session restoration plus Auth/Main Menu/Profile DOM navigation
- `packages/client/src/auth/supabase.ts`
  - browser-safe Supabase configuration, OAuth helpers, profile loading, validation, and updates
- `packages/client/src/auth/guest.ts`
  - tab-local guest profile creation, restoration, validation, and updates
- `packages/client/src/game.ts`
  - lazy Pixi app bootstrap, network entry, input, prediction, reconciliation, interpolation, camera, HUD orchestration
- `packages/client/src/net/NetworkManager.ts`
  - client WebSocket wrapper and message dispatch
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
