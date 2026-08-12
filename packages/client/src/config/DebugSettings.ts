// packages/client/src/config/DebugSettings.ts
// ─────────────────────────────────────────────────────────────────────────────
// Centralized debug feature flags. Flip the master switch or individual
// toggles to enable/disable debug-only features at runtime.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'labyrinth-debug-settings';
const MOBILE_POINTER_QUERY = '(hover: none) and (pointer: coarse)';

function hasDebugOverride(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('debug') === '1';
}

function isCoarsePointerDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(MOBILE_POINTER_QUERY).matches;
}

const SESSION_DEBUG_ENABLED = hasDebugOverride() || (import.meta.env.DEV && !isCoarsePointerDevice());
let adminAccess = false;

export interface DebugFlags {
  /** Master switch — when false, ALL debug features are disabled. */
  masterEnabled: boolean;
  /** Scroll-wheel zoom in/out */
  scrollZoom: boolean;
  /** Minus-key zoom toggle (zoom-out → zoom-in cycle) */
  zoomToggle: boolean;
  /** Click anywhere on the map to teleport the local player there */
  clickTeleport: boolean;
  /** Draw the logical maze-cell boundaries over the world. */
  cellBoundaries: boolean;
  /** Whether the network debug window is minimized */
  minimized: boolean;
}

const DEFAULTS: DebugFlags = {
  masterEnabled: SESSION_DEBUG_ENABLED,
  scrollZoom: SESSION_DEBUG_ENABLED,
  zoomToggle: SESSION_DEBUG_ENABLED,
  clickTeleport: SESSION_DEBUG_ENABLED,
  cellBoundaries: false,
  minimized: false,
};

/** Load persisted settings from localStorage, falling back to defaults. */
function load(): DebugFlags {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DebugFlags>;
      return { ...DEFAULTS, ...parsed };
    }
  } catch {
    /* ignore corrupt data */
  }
  return { ...DEFAULTS };
}

/** Save current settings to localStorage. */
function save(flags: DebugFlags): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
  } catch {
    /* storage full / blocked — silently ignore */
  }
}

// ── Singleton instance ──────────────────────────────────────────────────────

const flags: DebugFlags = load();

export const DebugSettings = {
  /** Apply the permission returned by the authoritative game server. */
  setAdminAccess(value: boolean): void {
    adminAccess = value;
  },

  /** Whether this server-verified session may expose debug UI and tools. */
  get sessionEnabled(): boolean {
    return adminAccess;
  },

  /** Check if a specific debug feature is currently active. */
  isEnabled(feature: keyof Omit<DebugFlags, 'masterEnabled'>): boolean {
    return adminAccess && flags.masterEnabled && flags[feature];
  },

  /** Check if the master debug switch is on. */
  get masterEnabled(): boolean {
    return adminAccess && flags.masterEnabled;
  },

  /** Toggle the master debug switch. */
  setMasterEnabled(value: boolean): void {
    if (!adminAccess) return;
    flags.masterEnabled = value;
    save(flags);
  },

  /** Toggle an individual feature flag. */
  setFlag(feature: keyof DebugFlags, value: boolean): void {
    if (!adminAccess) return;
    flags[feature] = value;
    save(flags);
  },

  /** Get a read-only snapshot of current flags. */
  getFlags(): Readonly<DebugFlags> {
    return { ...flags };
  },

  /** Reset all debug settings to defaults. */
  reset(): void {
    if (!adminAccess) return;
    Object.assign(flags, DEFAULTS);
    save(flags);
  },
};
