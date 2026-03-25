# Labyrinth 2D — Architecture Specification

> **Living document.** Updated as the project evolves.  
> Last updated: 2026-03-25 — Step 1 (Foundation)

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
| **Tilemap editor** | Tiled (exports `.tmj` JSON) | — |
| **Server runtime** | Node.js | ^22 LTS |
| **WebSocket server** | uWebSockets.js | ^20.x |
| **Monorepo** | npm workspaces | — |
| **Linting** | ESLint (flat config) | ^9.x |
| **Formatting** | Prettier | ^3.x |

### 2.1 Rendering Engine Choice — PixiJS over Phaser 3

**Decision: PixiJS v8.**

| Criterion | Phaser 3 | PixiJS v8 |
|---|---|---|
| **Rendering control** | Opaque scene graph; fights you on custom shaders and batched sprites | Full control over the render pipeline, custom batching, and shaders |
| **Tile-based rendering** | Built-in tilemap loader (Tiled support), but heavy abstraction | Lightweight — we compose our own tilemap renderer with `@pixi/tilemap` or manual sprite-sheets |
| **Bundle size** | ~1 MB minified (full framework) | ~250 KB minified (renderer only) |
| **60 fps / 10 animated sprites** | Easily achievable, but framework overhead is unnecessary | Easily achievable; lower overhead leaves headroom for particles, lighting, etc. |
| **Multiplayer fit** | Phaser's built-in update loop conflicts with authoritative-server reconciliation patterns | We own the game loop, making client-side prediction / reconciliation trivial to integrate |
| **ECS friendliness** | Scene-based, not ECS-native | Loop-agnostic; pairs perfectly with a lightweight ECS |

**Justification:** For a multiplayer game with an authoritative server, we need full ownership of the game loop and network-tick integration. Phaser's opinionated scene lifecycle adds friction. PixiJS gives us a lean, high-performance renderer that we wrap in our own systems. The tile-based world is simple enough that a custom tilemap renderer (or `@pixi/tilemap`) is trivial compared to the flexibility gained.

---

## 3. Multiplayer Architecture

### 3.1 Model — Authoritative Server

```
┌─────────────────────────────────────────────────────────┐
│                   AUTHORITATIVE SERVER                  │
│                                                         │
│  ┌─────────┐   ┌──────────────┐   ┌─────────────────┐  │
│  │  Room /  │──▶│  Game Loop   │──▶│  State Manager  │  │
│  │  Lobby   │   │  (~20 tps)   │   │  (delta snaps)  │  │
│  └─────────┘   └──────────────┘   └─────────────────┘  │
│       ▲                                    │            │
│       │  WebSocket (uWS)                   ▼            │
│  ┌─────────┐                    ┌─────────────────┐     │
│  │ Validate │◀──────────────────│   Broadcast      │    │
│  │ Inputs   │                   │  Delta Snapshots │    │
│  └─────────┘                    └─────────────────┘     │
└──────┬──────────────────────────────────┬───────────────┘
       │                                  │
       │         WebSocket (binary)       │
       ▼                                  ▼
┌──────────────┐                 ┌──────────────┐
│   Client A   │                 │   Client B   │
│              │                 │              │
│ ┌──────────┐ │                 │ ┌──────────┐ │
│ │ Predict  │ │                 │ │ Predict  │ │
│ │ locally  │ │                 │ │ locally  │ │
│ └──────────┘ │                 │ └──────────┘ │
│ ┌──────────┐ │                 │ ┌──────────┐ │
│ │Reconcile │ │                 │ │Reconcile │ │
│ │ w/ server│ │                 │ │ w/ server│ │
│ └──────────┘ │                 │ └──────────┘ │
│ ┌──────────┐ │                 │ ┌──────────┐ │
│ │ PixiJS   │ │                 │ │ PixiJS   │ │
│ │ Render   │ │                 │ │ Render   │ │
│ └──────────┘ │                 │ └──────────┘ │
└──────────────┘                 └──────────────┘
```

### 3.2 Key Principles

1. **Server is the single source of truth.** All game state mutations happen on the server. Clients send *inputs*, never state changes.
2. **Room/Lobby system.** Each group of up to 10 players joins a *room*. One maze instance is generated per room. Players can create or join rooms via a lobby screen.
3. **Server tick rate: ~20 tps.** Every tick the server:
   - Processes queued player inputs (movement, actions).
   - Runs game simulation (collision, triggers).
   - Computes a **delta state snapshot** (only changed entities).
   - Broadcasts the delta to all clients in the room.
4. **Client-side prediction.** The client applies local player inputs immediately for responsive 60-fps movement. Inputs are buffered with sequence numbers.
5. **Server reconciliation.** When the server snapshot arrives, the client:
   - Finds the last acknowledged input sequence.
   - Discards all inputs up to that sequence.
   - Re-applies any unacknowledged inputs on top of the server state.
6. **Entity interpolation.** Remote players are interpolated between the two most recent server snapshots to appear smooth despite the 20-tps update rate.

### 3.3 Network Protocol

| Direction | Message | Payload |
|---|---|---|
| `C → S` | `PlayerJoin` | `{ roomId, displayName }` |
| `C → S` | `PlayerInput` | `{ seq, tick, dx, dy, action? }` |
| `S → C` | `GameStateSnapshot` | `{ tick, players: Record<id, PlayerState>, events? }` |
| `S → C` | `RoomJoined` | `{ roomId, seed, config }` |
| `S → C` | `PlayerLeft` | `{ playerId }` |

All messages are serialized as **JSON** in Step 1. We will migrate to a binary protocol (MessagePack or FlatBuffers) in a later optimization step.

---

## 4. Pixel-Art Rendering Constraints

| Property | Value | Rationale |
|---|---|---|
| **Internal resolution** | **480 × 270** | 16:9 aspect ratio. At 16 px tiles → 30 × ~17 visible tiles. Large enough for a comfortable viewport, small enough that every pixel is visible at 4× scaling on 1080p. Matches the "chunky pixel" aesthetic of Stardew Valley. |
| **Tile size** | 16 × 16 px | Industry-standard for Stardew-style games. Good balance of detail and simplicity. |
| **Scaling** | Integer CSS scaling (4× on 1920×1080, computed dynamically) | Avoids sub-pixel artifacts. `canvas.style.width/height` are set to `internalRes × scaleFactor`. |
| **Anti-aliasing** | **Disabled** everywhere | PixiJS: `antialias: false`, `roundPixels: true`. CSS: `image-rendering: pixelated`. |
| **Texture filtering** | `NEAREST` | No bilinear interpolation on sprite textures. |
| **Background color** | `#1a1a2e` (deep navy) | Atmospheric default; overridden per-scene. |

---

## 5. Monorepo Structure

```
labyrinth-2d/
├── docs/
│   └── ARCHITECTURE.md              ← this file
├── packages/
│   ├── client/                      ← Vite + PixiJS browser client
│   │   ├── public/
│   │   │   └── tilesets/            ← Tiled tileset PNGs (served as static assets)
│   │   ├── src/
│   │   │   ├── main.ts              ← PixiJS app bootstrap + pixel-art config
│   │   │   ├── scenes/              ← Game scenes (lobby, game, results)
│   │   │   ├── entities/            ← Visual entity representations (Player, Tile)
│   │   │   ├── systems/             ← Client-side systems (input, rendering, camera)
│   │   │   ├── net/                 ← WebSocket client, prediction, reconciliation
│   │   │   ├── config/              ← Constants, rendering config
│   │   │   └── utils/               ← Helpers (math, interpolation)
│   │   ├── tilemaps/                ← Tiled .tmj files (imported via Vite)
│   │   ├── index.html
│   │   ├── style.css
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   ├── server/                      ← Node.js + uWebSockets.js server
│   │   ├── src/
│   │   │   ├── index.ts             ← uWS instantiation + WebSocket handler
│   │   │   ├── rooms/               ← Room/lobby management
│   │   │   ├── game/                ← Server-side game loop & simulation
│   │   │   ├── net/                 ← Message parsing, broadcasting
│   │   │   └── utils/               ← Helpers
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── shared/                      ← Shared types, constants, validation
│       ├── src/
│       │   └── index.ts             ← Message types, game constants
│       ├── tsconfig.json
│       └── package.json
├── package.json                     ← Root: npm workspaces config
├── eslint.config.js
├── .prettierrc
├── .gitignore
└── tsconfig.base.json               ← Shared TS compiler options
```

### 5.1 Tiled Tilemap Files

- **Tileset images** (`.png`): placed in `packages/client/public/tilesets/`. Vite serves `public/` as static assets at the root path, so they are reachable at `/tilesets/my-tileset.png`.
- **Tilemap JSON** (`.tmj`): placed in `packages/client/tilemaps/`. These are imported in TypeScript via Vite's JSON import (`import mapData from '../tilemaps/level1.tmj'`). Vite bundles them into the JS output, so they are available synchronously at runtime — no async fetch needed. In `vite.config.ts`, the `assetsInclude` option is configured to treat `.tmj` files as importable assets.

---

## 6. Package Dependency Graph

```
@labyrinth/client  ──depends-on──▶  @labyrinth/shared
@labyrinth/server  ──depends-on──▶  @labyrinth/shared
```

`@labyrinth/shared` has **zero runtime dependencies** — it is pure TypeScript types and constants.

---

## 7. Development Workflow

| Command | Description |
|---|---|
| `npm install` | Install all workspace dependencies |
| `npm run dev -w packages/client` | Start Vite dev server (hot reload) |
| `npm run dev -w packages/server` | Start server with `tsx --watch` |
| `npm run build -w packages/client` | Production Vite build |
| `npm run lint` | Lint all packages |
| `npm run format` | Format all packages with Prettier |
