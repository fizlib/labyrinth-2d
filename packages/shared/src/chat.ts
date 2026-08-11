/** Maximum number of characters accepted in one proximity-chat message. */
export const CHAT_MAX_LENGTH = 120;

/** Proximity-chat radius measured in the game's 16px world tiles. */
export const CHAT_PROXIMITY_TILES = 10;

/** Proximity-chat radius in world pixels. */
export const CHAT_PROXIMITY_RANGE = CHAT_PROXIMITY_TILES * 16;

/** Minimum time between accepted messages from one player. */
export const CHAT_SEND_COOLDOWN_MS = 750;

/**
 * Convert untrusted chat input to the single-line text accepted by the server.
 * Returns null for empty, non-string, or overlong input.
 */
export function normalizeChatMessageText(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const normalized = value.replace(/[\r\n\t]+/g, ' ').trim();
  if (normalized.length === 0 || normalized.length > CHAT_MAX_LENGTH) return null;
  return normalized;
}

/** Whether two authoritative world positions are inside the chat radius. */
export function isWithinChatProximity(
  first: { x: number; y: number },
  second: { x: number; y: number },
): boolean {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return dx * dx + dy * dy <= CHAT_PROXIMITY_RANGE * CHAT_PROXIMITY_RANGE;
}
