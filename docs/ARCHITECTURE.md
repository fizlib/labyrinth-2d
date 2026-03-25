# Labyrinth 2D — Architecture Specification

> **Living document.** Updated as the project evolves.  
> Last updated: 2026-03-25 — Step 7 (Labyrinth Structure & Spawn Logic)

---

## 1. Project Overview

A co-op online 2D top-down pixel-art labyrinth game (Stardew Valley aesthetic) for groups of up to **10 players**. All players share one procedurally-generated maze instance and must cooperate to find the exit. The game runs entirely in the browser.

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
| `x`, `y` | `number` | Pixel position (top-left of 16×16 sprite) |
| `lastProcessedInput` | `number` | Highest acknowledged input sequence for reconciliation |

---

## 4. Shared Physics & Collision

All physics run in `@labyrinth/shared` so client and server execute **identical** logic.

| Constant | Value | Purpose |
|---|---|---|
| `PLAYER_SPEED` | 150 px/s | Movement speed |
| `PLAYER_HITBOX` | 12 px | AABB hitbox size (centered in 16×16 sprite) |
| `HITBOX_OFFSET` | 2 px | Offset from sprite top-left to hitbox top-left |
| `SERVER_TICK_S` | 0.05 s | One server tick duration |

### 4.1 Core Functions

- **`applyInput(x, y, input, dt)`** — Pure movement (no collision). Returns new `{x, y}`.
- **`isPositionValid(x, y, map)`** — AABB check: is the 12×12 hitbox at `(x+2, y+2)` free of wall tiles?
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

| ID | Meaning |
|---|---|
| `0` | Floor (walkable) |
| `1` | Wall (solid, blocks movement) |

### 5.3 Spawn Points

3 spawn points at maze corners (tile coordinates, center of the 3×3 corner cell):

| Index | Cell | Tile Coords | Description |
|---|---|---|---|
| 0 | `(0, 0)` | `(2, 2)` | Top-left corner |
| 1 | `(21, 0)` | `(86, 2)` | Top-right corner |
| 2 | `(0, 21)` | `(2, 86)` | Bottom-left corner |

Server assigns spawns via **round-robin**: `SPAWN_POINTS[joinCounter % 3]`. The `joinCounter` only increments and never decrements, ensuring even distribution even after disconnects.

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

### 6.2 Current Rendering (Primitives)

All visuals are currently **PixiJS Graphics primitives** (no textures yet):

| Element | Rendering |
|---|---|
| Wall tiles | Gray (`#4a4a68`) filled rectangles with beveled edges (highlight top-left, shadow bottom-right) |
| Floor tiles | Dark navy (`#1e1e32`) with subtle grid lines |
| Local player | Green (`#00e676`) 16×16 square |
| Remote players | Red (`#ff5252`) 16×16 squares |

---

## 7. Monorepo Structure

```
labyrinth-2d/
├── docs/
│   └── ARCHITECTURE.md              ← this file
├── packages/
│   ├── client/                      ← Vite + PixiJS browser client
│   │   ├── public/
│   │   │   └── tilesets/            ← (future) tileset PNGs
│   │   ├── src/
│   │   │   ├── main.ts              ← App bootstrap, game loop, camera, rendering
│   │   │   └── net/
│   │   │       ├── NetworkManager.ts ← WebSocket client, message dispatch
│   │   │       └── SnapshotBuffer.ts ← Timestamped snapshot storage for interpolation
│   │   ├── index.html
│   │   ├── style.css
│   │   ├── vite.config.ts
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
