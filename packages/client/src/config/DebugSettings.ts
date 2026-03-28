// packages/client/src/config/DebugSettings.ts
// ─────────────────────────────────────────────────────────────────────────────
// Centralized debug feature flags. Flip the master switch or individual
// toggles to enable/disable debug-only features at runtime.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'labyrinth-debug-settings';

export interface DebugFlags {
  /** Master switch — when false, ALL debug features are disabled. */
  masterEnabled: boolean;
  /** Scroll-wheel zoom in/out */
  scrollZoom: boolean;
  /** Minus-key zoom toggle (zoom-out → zoom-in cycle) */
  zoomToggle: boolean;
  /** Click anywhere on the map to teleport the local player there */
  clickTeleport: boolean;
}

const DEFAULTS: DebugFlags = {
  masterEnabled: true,
  scrollZoom: true,
  zoomToggle: true,
  clickTeleport: true,
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
  /** Check if a specific debug feature is currently active. */
  isEnabled(feature: keyof Omit<DebugFlags, 'masterEnabled'>): boolean {
    return flags.masterEnabled && flags[feature];
  },

  /** Check if the master debug switch is on. */
  get masterEnabled(): boolean {
    return flags.masterEnabled;
  },

  /** Toggle the master debug switch. */
  setMasterEnabled(value: boolean): void {
    flags.masterEnabled = value;
    save(flags);
  },

  /** Toggle an individual feature flag. */
  setFlag(feature: keyof DebugFlags, value: boolean): void {
    flags[feature] = value;
    save(flags);
  },

  /** Get a read-only snapshot of current flags. */
  getFlags(): Readonly<DebugFlags> {
    return { ...flags };
  },

  /** Reset all debug settings to defaults. */
  reset(): void {
    Object.assign(flags, DEFAULTS);
    save(flags);
  },
};
