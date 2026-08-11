import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHAT_MAX_LENGTH,
  CHAT_PROXIMITY_RANGE,
  isWithinChatProximity,
  normalizeChatMessageText,
} from '../dist/index.js';

test('chat text is trimmed, kept single-line, and limited to 120 characters', () => {
  assert.equal(
    normalizeChatMessageText('  hello nearby players  '),
    'hello nearby players',
  );
  assert.equal(normalizeChatMessageText('first\nsecond\tthird'), 'first second third');
  assert.equal(normalizeChatMessageText(' '.repeat(20)), null);
  assert.equal(normalizeChatMessageText(null), null);

  const maximum = 'x'.repeat(CHAT_MAX_LENGTH);
  assert.equal(normalizeChatMessageText(maximum), maximum);
  assert.equal(normalizeChatMessageText(`${maximum}x`), null);
});

test('chat proximity includes the sender and the exact 160px boundary', () => {
  const sender = { x: 50, y: 70 };
  assert.equal(CHAT_PROXIMITY_RANGE, 160);
  assert.equal(isWithinChatProximity(sender, sender), true);
  assert.equal(
    isWithinChatProximity(sender, { x: sender.x + CHAT_PROXIMITY_RANGE, y: sender.y }),
    true,
  );
  assert.equal(
    isWithinChatProximity(sender, {
      x: sender.x + CHAT_PROXIMITY_RANGE + 0.01,
      y: sender.y,
    }),
    false,
  );
  assert.equal(isWithinChatProximity(sender, { x: 146, y: 198 }), true);
  assert.equal(isWithinChatProximity(sender, { x: 147, y: 198 }), false);
});
