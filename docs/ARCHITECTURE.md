# Labyrinth 2D Architecture

Last updated: 2026-07-14 - Hidden survivor/warden roles and warden map

## Project Overview

Labyrinth 2D is a multiplayer top-down pixel-art labyrinth game built as a TypeScript monorepo with three workspace packages:

- `packages/shared`: shared constants, protocol types, procedural map generation, navigation, and collision.
- `packages/server`: the authoritative multiplayer simulation and room management.
- `packages/client`: the PixiJS renderer, client prediction, interpolation, HUD, and input handling.

One room owns one maze instance. The server is authoritative for player state, hidden role seats, runestones, portal state, and wisdom orbs. The client predicts local movement for responsiveness, reconciles against server snapshots, and interpolates remote players for smoother motion.

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
| `USE_WISDOM_ORB` | Spend one orb to request a hub-direction hint |
| `DEBUG_TELEPORT` | Debug-only teleport helper used by developer tooling |

#### Server -> Client

| Message | Purpose |
| --- | --- |
| `ROOM_JOINED` | Initial join payload with `playerId`, `mapSeed`, full `gameState`, and the recipient's private role/orb inventory |
| `TICK_UPDATE` | Authoritative room snapshot broadcast every server tick |
| `PLAYER_LEFT` | Notify clients that one player disconnected |
| `RUNESTONE_ACTIVATED` | Broadcast that one runestone is now active |
| `ALL_RUNESTONES_ACTIVATED` | Broadcast the existing portal coordinates once all runestones are active |
| `WISDOM_ORB_USED` | Private response to the player who spent an orb, containing the hint direction and remaining orb count |
| `PLAYER_ROLE_CHANGED` | Private debug response that replaces the recipient's role and orb inventory |
| `DEBUG_PLAYER_ROLE` | Private debug response containing a selected player's authoritative role |
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
| `facing` | `'up' | 'down' | 'left' | 'right'` | Authoritative sprite facing |
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

## Shared Gameplay Systems

### Collision and Movement

- Shared movement constants and collision helpers live in `packages/shared/src/physics.ts`.
- Both client and server use the same feet-based collision logic.
- Player position is stored at the feet, not the sprite center, which keeps wall contact and sorting consistent.
- Closed gate tiles are solid map obstacles, so both client prediction and server simulation block on them automatically.
- Bridge obstacles use the same six authored rectangle/right-triangle colliders on the client and server, leaving a two-tile-wide walkable stone span between their forest banks.
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
- Each survivor starts with `1` wisdom orb; wardens start with `0` and server-side role validation rejects their orb requests.
- Roles and wisdom orbs are server-authoritative private room state. They are never included in broadcast `GameState` snapshots.
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

## Map System

Map generation lives in `packages/shared/src/maps/level1.ts`.

`generateMazeLayout()` returns the tile map, spawn points, gate placements, and a visual-only `dirtMask` used by the client ground renderer and minimap.

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

### Spawns and Objective Placement

- Team spawn points are computed with BFS over the cell graph, not hardcoded coordinates.
- `SPAWN_DISTANCE` is currently `10` cell-steps from the hub.
- Spawn selection prefers angular separation around the map so teams begin in different sectors.
- Closed gates are chosen from vertical (north-south) corridor cells on spawn-to-hub paths and are rendered as one-tile-thick horizontal barriers through the middle of those cells.
- Each gate also produces a short rectangular dirt band in shared layout data. The dirt mask is visual-only and does not affect collision or navigation.
- Bridge selection is deterministic per maze seed and is intentionally global rather than restricted to squad routes.
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
  - wardens receive a solid red frame with no fog-of-war and a wooden corner expand button; the fixed whole-maze view is scaled to fit the internal screen, marks the portal and the local warden's position, and provides a matching contract button
- `WisdomOrbHud`
  - screen-space HUD in the top-left corner
  - survivors see one orb slot and the current remaining count; wardens do not receive this HUD
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
- Runestone interaction prompt
  - world-space `[E]` prompt shown above nearby inactive runestones

### Input Handling

- Movement: arrow keys or `WASD`, plus the mobile D-pad on supported touch devices
- Intro dialogue advance: `E`, the clickable arrow button, or the mobile `E` button while the intro dialogue is visible
- Intro dialogue skip: `E`, the clickable arrow button, or the mobile `E` button while the current page is still typing
- Runestone interaction: `E` or the mobile `E` button after the intro dialogue is dismissed
- Wisdom orb use: `Q`, the mobile `Q` button, or click a filled orb in the HUD
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

### Server Package

- `packages/server/src/index.ts`
  - WebSocket server bootstrap and protocol routing
- `packages/server/src/Room.ts`
  - room lifecycle, hidden role seats/private inventories, authoritative state, tick loop, runestone logic, portal activation, wisdom-orb handling

### Client Package

- `packages/client/src/main.ts`
  - Pixi app bootstrap, input, prediction, reconciliation, interpolation, camera, HUD orchestration
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
