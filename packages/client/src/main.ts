// packages/client/src/main.ts
// ─────────────────────────────────────────────────────────────────────────────
// Labyrinth 2D — Client Entry Point
// ─────────────────────────────────────────────────────────────────────────────
//
// MULTIPLAYER ARCHITECTURE (Client-Side):
//
// 1. CLIENT-SIDE PREDICTION: The client applies local player inputs
//    immediately each frame for responsive 60-fps movement. Inputs are
//    buffered with monotonically increasing sequence numbers.
//
// 2. SERVER RECONCILIATION: When a GameStateSnapshot arrives from the
//    authoritative server:
//    a) Find the last acknowledged input sequence (lastProcessedInput).
//    b) Discard all locally buffered inputs up to that sequence.
//    c) Snap local player to the server-authoritative position.
//    d) Re-apply all unacknowledged inputs on top of the server state.
//    This corrects any prediction errors while keeping movement smooth.
//
// 3. ENTITY INTERPOLATION: Remote players (not the local player) are
//    interpolated between the two most recent server snapshots. This hides
//    the 20-tps update rate and produces smooth movement at 60 fps.
//
// Step 1: This file only bootstraps the PixiJS Application with pixel-art
// rendering constraints. No game logic, no scenes — just the renderer.
// ─────────────────────────────────────────────────────────────────────────────

import { Application } from 'pixi.js';
import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from '@labyrinth/shared';

/**
 * Compute the largest integer scale factor that fits the internal resolution
 * within the given viewport dimensions without exceeding them.
 */
function getIntegerScale(viewportW: number, viewportH: number): number {
  const scaleX = Math.floor(viewportW / INTERNAL_WIDTH);
  const scaleY = Math.floor(viewportH / INTERNAL_HEIGHT);
  return Math.max(1, Math.min(scaleX, scaleY));
}

/**
 * Resize the PixiJS canvas to fill the viewport with integer scaling.
 * This ensures every game pixel maps to an exact NxN block of screen pixels,
 * preventing sub-pixel artifacts that ruin the pixel-art aesthetic.
 */
function resizeCanvas(app: Application): void {
  const scale = getIntegerScale(window.innerWidth, window.innerHeight);

  const canvasWidth = INTERNAL_WIDTH * scale;
  const canvasHeight = INTERNAL_HEIGHT * scale;

  // Set the CSS display size (integer-scaled)
  app.canvas.style.width = `${canvasWidth}px`;
  app.canvas.style.height = `${canvasHeight}px`;

  // Resize the internal renderer resolution
  app.renderer.resize(INTERNAL_WIDTH, INTERNAL_HEIGHT);
}

async function main(): Promise<void> {
  // ── Create PixiJS Application ───────────────────────────────────────────
  const app = new Application();

  await app.init({
    // ── Pixel-Art Rendering Constraints ─────────────────────────────────
    width: INTERNAL_WIDTH, // 480px internal width
    height: INTERNAL_HEIGHT, // 270px internal height
    antialias: false, // CRITICAL: No anti-aliasing for pixel art
    roundPixels: true, // Snap all sprites to integer coordinates
    backgroundColor: 0x1a1a2e, // Deep navy — atmospheric default

    // ── Canvas Setup ────────────────────────────────────────────────────
    canvas: document.createElement('canvas'),
    resizeTo: undefined, // We handle resizing manually for integer scaling
  });

  // ── Mount Canvas ──────────────────────────────────────────────────────
  const container = document.getElementById('game-container');
  if (!container) {
    throw new Error('Missing #game-container element in index.html');
  }
  container.appendChild(app.canvas);

  // ── Apply Integer Scaling ─────────────────────────────────────────────
  resizeCanvas(app);
  window.addEventListener('resize', () => resizeCanvas(app));

  // ── Startup Log ───────────────────────────────────────────────────────
  console.info('─────────────────────────────────────────────────');
  console.info('  🏰 Labyrinth 2D Client');
  console.info(`  Internal: ${INTERNAL_WIDTH}×${INTERNAL_HEIGHT}`);
  console.info(`  Scale: ${getIntegerScale(window.innerWidth, window.innerHeight)}×`);
  console.info(`  Renderer: ${app.renderer.type}`);
  console.info('─────────────────────────────────────────────────');

  // ── Game Loop (Step 2+) ───────────────────────────────────────────────
  // app.ticker.add((ticker) => {
  //   const dt = ticker.deltaMS;
  //   // TODO: Process input, run client prediction, interpolate entities, render
  // });
}

main().catch(console.error);
