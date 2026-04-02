// packages/client/vite.config.ts
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  // ── Resolve ───────────────────────────────────────────────────────────────
  resolve: {
    alias: {
      // Allow clean imports like `@/systems/input`
      '@': path.resolve(__dirname, 'src'),
    },
  },

  // ── JSON & Asset Handling ─────────────────────────────────────────────────
  // Treat Tiled tilemap files (.tmj) as importable JSON assets.
  // Usage: `import mapData from '../tilemaps/level1.tmj'`
  // Vite will inline them into the JS bundle (sync, no fetch required).
  assetsInclude: ['**/*.tmj'],

  // ── Dev Server ────────────────────────────────────────────────────────────
  server: {
    port: 5173,
    host: true, // Listen on all interfaces (including LAN/IPv4)
    // Proxy WebSocket connections to the game server during development
    proxy: {
      '/ws': {
        target: 'ws://localhost:9001',
        ws: true,
      },
    },
  },

  // ── Build ─────────────────────────────────────────────────────────────────
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
});
