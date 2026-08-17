// packages/client/src/config/DebugSettings.ts
// ─────────────────────────────────────────────────────────────────────────────
// Centralized admin-only debug settings. The three direct manipulation tools
// intentionally share one switch so an administrator cannot end up with a
// partially enabled toolset.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'labyrinth-debug-settings';
let adminAccess = false;

export interface DebugFlags {
  /** Scroll zoom, minus-key zoom toggling, and click teleport. */
  debugToolsEnabled: boolean;
  /** Draw the logical maze-cell boundaries over the world. */
  cellBoundaries: boolean;
}

const DEFAULTS: DebugFlags = {
  debugToolsEnabled: true,
  cellBoundaries: false,
};

/** Load persisted settings from localStorage, falling back to defaults. */
function load(): DebugFlags {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DebugFlags> & {
        masterEnabled?: boolean;
      };
      return {
        debugToolsEnabled:
          parsed.debugToolsEnabled ?? parsed.masterEnabled ?? DEFAULTS.debugToolsEnabled,
        cellBoundaries: parsed.cellBoundaries ?? DEFAULTS.cellBoundaries,
      };
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

  /** Check if a debug feature is currently active. */
  isEnabled(
    feature: 'scrollZoom' | 'zoomToggle' | 'clickTeleport' | 'cellBoundaries',
  ): boolean {
    if (!adminAccess) return false;
    return feature === 'cellBoundaries'
      ? flags.cellBoundaries
      : flags.debugToolsEnabled;
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
