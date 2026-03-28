# Labyrinth 2D — Architecture Specification

> **Living document.** Updated as the project evolves.  
> Last updated: 2026-03-26 — Step 9 (2.5D Perspective, Feet-Based Collision, Multi-Layer Tiles)

---

## 1. Project Overview

A co-op online 2D top-down pixel-art labyrinth game (Stardew Valley aesthetic) for groups of up to **9 players** (3 teams of 3). All players share one procedurally-generated maze instance and must cooperate to find the exit. The game runs entirely in the browser.

---

## 2. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| **Language** | TypeScript | ^5.7 |
| **Client bundler** | Vite | ^6.x |
| **Rendering engine** | PixiJS | ^8.x |
| **Server runtime** | Node.js | ^22 LTS |
| **WebSocket server** | uWebSockets.js | ^20.x |
| **Monorepo** | npm workspaces | — |

### 2.1 Rendering Engine Choice — PixiJS over Phaser 3

**Decision: PixiJS v8.**

For a multiplayer game with an authoritative server, we need full ownership of the game loop and network-tick integration. Phaser's opinionated scene lifecycle adds friction. PixiJS gives us a lean, high-performance renderer (~250 KB vs ~1 MB) that we wrap in our own systems. The tile-based world is simple enough that a custom tilemap renderer is trivial compared to the flexibility gained.

---

## 3. Multiplayer Architecture

### 3.1 Model — Authoritative Server

```
┌─────────────────────────────────────────────────────────┐
│                   AUTHORITATIVE SERVER                  │
│                                                         │
│  ┌─────────┐   ┌──────────────┐   ┌─────────────────┐  │
│  │  Room /  │──▶│  Game Loop   │──▶│  State Manager  │  │
│  │  Lobby   │   │  (~20 tps)   │   │  (full snaps)   │  │
│  └─────────┘   └──────────────┘   └─────────────────┘  │
│       ▲                                    │            │
│       │  WebSocket (uWS)                   ▼            │
│  ┌─────────┐                    ┌─────────────────┐     │
│  │  Queue   │◀──────────────────│   Broadcast      │    │
│  │  Inputs  │                   │  TickUpdate      │    │
│  └─────────┘                    └─────────────────┘     │
└──────┬──────────────────────────────────┬───────────────┘
       │                                  │
       │         WebSocket (JSON)         │
       ▼                                  ▼
┌──────────────┐                 ┌──────────────┐
│   Client A   │                 │   Client B   │
│              │                 │              │
│ ┌──────────┐ │                 │ ┌──────────┐ │
│ │ Predict  │ │                 │ │ Predict  │ │
│ │ w/ AABB  │ │                 │ │ w/ AABB  │ │
│ └──────────┘ │                 │ └──────────┘ │
│ ┌──────────┐ │                 │ ┌──────────┐ │
│ │Reconcile │ │                 │ │Reconcile │ │
│ │ w/ server│ │                 │ │ w/ server│ │
│ └──────────┘ │                 │ └──────────┘ │
│ ┌──────────┐ │                 │ ┌──────────┐ │
│ │Interpolat│ │                 │ │Interpolat│ │
│ │ remotes  │ │                 │ │ remotes  │ │
│ └──────────┘ │                 │ └──────────┘ │
│ ┌──────────┐ │                 │ ┌──────────┐ │
│ │ PixiJS   │ │                 │ │ PixiJS   │ │
│ │ Render   │ │                 │ │ Render   │ │
│ └──────────┘ │                 │ └──────────┘ │
└──────────────┘                 └──────────────┘
```

### 3.2 Key Principles

1. **Server is the single source of truth.** All game state mutations happen on the server. Clients send *inputs*, never state changes.
2. **Room/Lobby system.** Each group of up to 10 players joins a *room*. One maze instance is generated per room.
3. **Server tick rate: ~20 tps (50ms).** Every tick the server:
   - Processes **all queued** player inputs per player (not just the latest).
   - Applies movement via shared `applyInputWithCollision()` with axis-independent wall sliding.
   - Updates `lastProcessedInput` per player for client reconciliation.
   - Broadcasts a full-state `TickUpdate` to all clients.
4. **Input queuing.** Inputs are queued server-side and all processed per tick with `dtPerInput = SERVER_TICK_S / queue.length`, keeping total displacement proportional regardless of client FPS.
5. **Client-side prediction.** The client applies local player inputs immediately at 60 fps using the **same** `applyInputWithCollision()` function for zero perceived latency. Inputs are buffered with monotonically increasing sequence numbers.
6. **Server reconciliation.** When a `TickUpdate` arrives, the client:
   - Snaps local position to the server's authoritative state.
   - Discards all inputs where `sequenceNumber <= lastProcessedInput`.
   - Re-applies remaining unacknowledged inputs with collision.
7. **Entity interpolation.** Remote players are rendered 100ms behind real-time, interpolated (lerp) between two bracketing server snapshots stored in a `SnapshotBuffer`. This hides the 20-tps update rate.

### 3.3 Network Protocol

| Direction | Type | Payload |
|---|---|---|
| `C → S` | `JOIN_ROOM` | `{ roomId, displayName }` |
| `C → S` | `PLAYER_INPUT` | `{ sequenceNumber, up, down, left, right }` |
| `S → C` | `ROOM_JOINED` | `{ roomId, playerId, gameState }` |
| `S → C` | `TICK_UPDATE` | `{ gameState: { tick, players[] } }` |
| `S → C` | `PLAYER_LEFT` | `{ playerId }` |
| `S → C` | `ERROR` | `{ code, message }` |

All messages are **JSON**-serialized. Binary protocol migration planned for a later optimization step.

### 3.4 Player State

Each player in `GameState.players[]` carries:

| Field | Type | Purpose |
|---|---|---|
| `id` | `string` | Server-assigned unique ID |
| `displayName` | `string` | Player-chosen name |
| `teamId` | `number` | Team index (0, 1, or 2). Maps 1:1 with `SPAWN_POINTS[teamId]`. |
| `x`, `y` | `number` | Pixel position (bottom-center of sprite / feet position) |
| `facing` | `FacingDirection` | Current facing direction (`'up'`/`'down'`/`'left'`/`'right'`). Derived by server from last input. |
| `isMoving` | `boolean` | Whether the player was moving in their last input. Derived by server. |
| `lastProcessedInput` | `number` | Highest acknowledged input sequence for reconciliation |

---

## 4. Shared Physics & Collision

All physics run in `@labyrinth/shared` so client and server execute **identical** logic.

### 4.1 Feet-Based Collision (2.5D)

Player `(x, y)` = **bottom-center** of sprite (feet position). The collision hitbox covers only the feet area:

| Constant | Value | Purpose |
|---|---|---|
| `PLAYER_SPEED` | 80 px/s | Movement speed |
| `FEET_HITBOX_W` | 8 px | Width of feet collision box, centered at x |
| `FEET_HITBOX_H` | 12 px | Height of feet collision box, extends upward from y |
| `SERVER_TICK_S` | 0.05 s | One server tick duration |

Feet hitbox bounds: `left = x - 4`, `top = y - 12`, `right = x + 3`, `bottom = y - 1`.

This allows the top half of the player sprite to visually overlap wall tiles above, creating a 2.5D depth illusion.

### 4.2 Core Functions

- **`applyInput(x, y, input, dt)`** — Pure movement (no collision). Returns new `{x, y}`.
- **`isPositionValid(x, y, map)`** — AABB check: is the 8×12 feet hitbox free of solid tiles (cliff face)?
- **`applyInputWithCollision(x, y, input, dt, map)`** — Applies movement with **axis-independent sliding**: tries X-axis first, then Y-axis independently. Prevents getting stuck in corners.

---

## 5. Map System

### 5.1 Procedural Maze Generation

Maps are generated in `@labyrinth/shared` so both client and server use the same data.

| Property | Value |
|---|---|
| **Grid size** | 91×91 tiles (1456×1456 px) |
| **Tile size** | 16×16 px |
| **Maze algorithm** | Recursive backtracking (iterative, stack-based DFS) |
| **PRNG** | Seeded mulberry32 (seed: `42`) for determinism |
| **Cell structure** | Each maze "cell" = 3×3 floor tiles. Walls between cells = 1 tile thick. |
| **Cell step** | 4 tiles (3 floor + 1 wall) per cell |
| **Cell grid** | 22×22 cells |
| **Central hub** | 9×9 floor room at map center, 3 entrances (north, west, east) |
| **Corridor width** | 3 tiles wide throughout |

### 5.2 Tile IDs

| ID | Constant | Meaning | Collision | Render Layer |
|---|---|---|---|---|
| `0` | `TILE_GRASS` | Grass floor | walkable | Background (`depth = -100`) |
| `1` | `TILE_DIRT` | Dirt floor (near-cliff transition) | walkable | Background (`depth = -100`) |
| `2` | `TILE_CLIFF_FACE` | Vertical rock wall | **solid** | Main (`depth = bottom Y`) |
| `3` | `TILE_CLIFF_TOP` | Grassy overhang | **solid** | Background (`depth = -100`) |
| `4` | `TILE_CLIFF_BODY` | Dark interior/non-south wall | **solid** | Background (`depth = -100`) |
| `5` | `TILE_WALL_SIDE_LEFT` | Left vertical edge of cliff | **solid** | Main (`depth = bottom Y`) |
| `6` | `TILE_WALL_SIDE_RIGHT` | Right vertical edge of cliff | **solid** | Main (`depth = bottom Y`) |
| `7` | `TILE_WALL_BOTTOM` | Bottom horizontal edge of cliff | **solid** | Main (`depth = bottom Y`) |
| `8` | `TILE_WALL_CORNER_TL` | Outer corner: top-left | **solid** | Main (`depth = bottom Y`) |
| `9` | `TILE_WALL_CORNER_TR` | Outer corner: top-right | **solid** | Main (`depth = bottom Y`) |
| `10` | `TILE_WALL_CORNER_BL` | Outer corner: bottom-left | **solid** | Main (`depth = bottom Y`) |
| `11` | `TILE_WALL_CORNER_BR` | Outer corner: bottom-right | **solid** | Main (`depth = bottom Y`) |
| `12` | `TILE_WALL_TOP_EDGE` | Top rock rim (north-facing edge) | **solid** | Main (`depth = bottom Y`) |

Post-processing passes convert the raw maze output: walls→cliff face, floor near cliff→dirt, floor above cliff→cliff top.

### 5.3 Spawn Points

Spawn points are **dynamically computed per-room** so that all teams walk the same distance to reach the center hub.

| Property | Value |
|---|---|
| **Algorithm** | BFS on the 15×15 cell graph from hub cells |
| **`SPAWN_DISTANCE`** | Configurable (default: **7** cell-steps). Set in `index.ts`. Valid range: 1–12. |
| **Selection** | 360° divided into `MAX_TEAMS` angular sectors; one spawn per sector |
| **Fallback** | Distance widens ±1, ±2, … until enough candidates; corner cells as last resort |
| **Hub entrances** | 4 (north, south, west, east) — ensures paths exist in all directions |

**How it works:**
1. After maze generation, `computeSpawnPoints(data, distance, numTeams)` reconstructs cell connectivity from the tile array.
2. Multi-source BFS floods outward from all hub cells (distance = 0).
3. Candidate cells at exactly `SPAWN_DISTANCE` are collected.
4. Candidates are binned into angular sectors (120° each for 3 teams) and the best per sector is selected — preferring exact distance, then closest to sector center.

Server assigns spawns via **team assignment**: each team (0, 1, 2) maps to `spawnPoints[teamId]`. When a player joins, they are assigned to the first team with fewer than `PLAYERS_PER_TEAM` (3) members. If no team has room, the room is full (max 3 teams × 3 players = 9).

---

## 6. Pixel-Art Rendering Constraints

| Property | Value | Rationale |
|---|---|---|
| **Internal resolution** | **480 × 270** | 16:9 ratio. At 16 px tiles → 30×17 visible tiles. Matches "chunky pixel" aesthetic. |
| **Tile size** | 16 × 16 px | Industry-standard for Stardew-style games. |
| **Scaling** | Integer CSS scaling (dynamically computed) | Avoids sub-pixel artifacts. |
| **Anti-aliasing** | **Disabled** | PixiJS: `antialias: false`, `roundPixels: true`. CSS: `image-rendering: pixelated`. |
| **Background color** | `#0e0e1a` (deep dark) | Atmospheric default. |

### 6.1 Camera System

The map (91×91 = 1456×1456 px) is larger than the viewport (480×270). A `worldContainer` holds the tilemap and player layers. Each frame, `updateCamera()`:

1. Centers the local player on screen.
2. Clamps to map boundaries so no area outside the map is visible.
3. Rounds to integer pixels for pixel-perfect rendering.

### 6.2 Rendering (Multi-Layer 2.5D)

All visuals use **PixiJS Sprite / AnimatedSprite** objects with textures. The tilemap is rendered in 3 depth layers for 2.5D perspective:

| Element | Rendering | Depth |
|---|---|---|
| Grass tiles | 16×16 green grass sprite | `-100` (background) |
| Dirt tiles | 16×16 brown dirt sprite | `-100` (background) |
| Cliff face tiles | 16×16 dark rocky wall sprite | `(tileY+1) * tileSize` (Y-sorted with players) |
| Cliff top tiles | 16×16 grassy overhang sprite | `10000` (foreground, always on top) |
| Local player | 16×32 AnimatedSprite, anchor `(0.5, 1.0)` | `sprite.y` (Y-sorted) |
| Remote players | 16×32 AnimatedSprite, anchor `(0.5, 1.0)` | `sprite.y` (Y-sorted) |

**Sprite anchors:** All player sprites use bottom-center anchor `(0.5, 1.0)`. The `x,y` coordinate = feet position.

**Asset loading:** The client attempts to load `assets/tiles.png` (13 tile types) and per-team player spritesheets `assets/player_0.png`, `assets/player_1.png` (128×128, 8 cols × 4 rows of 16×32 frames each). Teams without a dedicated file fall back to team 0's sprite. If assets fail entirely, procedural fallback textures are used via `FallbackTextures.ts`.

**Animations:** 8 animation keys: `idle-up`, `idle-down`, `idle-left`, `idle-right`, `walk-up`, `walk-down`, `walk-left`, `walk-right`. Walk animations use 6 frames per direction; idle uses 2 frames. Each team has its own set of animation textures.

**Y-Sorting:** The world container uses `sortableChildren = true`. Cliff face tiles depth = bottom Y of tile. Player depth = `sprite.y`. This creates correct overlap: players walk behind cliffs when below them, in front when above.

---

## 7. Monorepo Structure

```
labyrinth-2d/
├── docs/
│   └── ARCHITECTURE.md              ← this file
├── packages/
│   ├── client/                      ← Vite + PixiJS browser client
│   │   ├── public/
│   │   │   └── assets/              ← (optional) tiles.png, player.png
│   │   ├── src/
│   │   │   ├── main.ts              ← App bootstrap, game loop, camera, rendering
│   │   │   ├── assets/
│   │   │   │   ├── AssetLoader.ts    ← Load PNGs with fallback to generated textures
│   │   │   │   └── FallbackTextures.ts ← Procedural texture generator (walls, floors, player)
│   │   │   └── net/
│   │   │       ├── NetworkManager.ts ← WebSocket client, message dispatch
│   │   │       └── SnapshotBuffer.ts ← Timestamped snapshot storage for interpolation
│   │   ├── index.html
│   │   ├── style.css
│   │   ├── vite.config.ts
│   │   ├── vite-env.d.ts            ← Vite type declarations
│   │   ├── tsconfig.json
│   │   └── package.json
│   ├── server/                      ← Node.js + uWebSockets.js server
│   │   ├── src/
│   │   │   ├── index.ts             ← uWS instantiation + WebSocket handler
│   │   │   └── Room.ts              ← Room management, game loop, input queue, collision
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── shared/                      ← Shared types, constants, physics, maps
│       ├── src/
│       │   ├── index.ts             ← Re-exports, message types, game constants
│       │   ├── physics.ts           ← PLAYER_SPEED, applyInput, collision (AABB + sliding)
│       │   └── maps/
│       │       └── level1.ts        ← 91×91 procedural maze (recursive backtracking)
│       ├── tsconfig.json
│       └── package.json
├── package.json                     ← Root: npm workspaces config
├── tsconfig.base.json               ← Shared TS compiler options
└── .gitignore
```

---

## 8. Package Dependency Graph

```
@labyrinth/client  ──depends-on──▶  @labyrinth/shared
@labyrinth/server  ──depends-on──▶  @labyrinth/shared
```

`@labyrinth/shared` has **zero runtime dependencies** — pure TypeScript types, constants, physics, and map data.

---

## 9. Development Workflow

| Command | Description |
|---|---|
| `npm install` | Install all workspace dependencies |
| `npm run dev -w packages/client` | Start Vite dev server (hot reload) |
| `npm run dev -w packages/server` | Start server with `tsx --watch` |
| `npm run build -w packages/client` | Production Vite build |
