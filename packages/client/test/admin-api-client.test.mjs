import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAdminApiUrl } from '../dist/admin/AdminApiUrl.js';

test('uses the same-origin Vite proxy during local development', () => {
  assert.equal(
    buildAdminApiUrl(
      'overview',
      'ws://127.0.0.1:9001/ws',
      'http://localhost:5173',
      true,
    ),
    'http://localhost:5173/admin-api/overview',
  );
});

test('preserves admin query parameters instead of encoding them into the path', () => {
  assert.equal(
    buildAdminApiUrl(
      'users?page=1&perPage=25&q=&admin=all&suspension=all',
      'ws://127.0.0.1:9001/ws',
      'http://localhost:5173',
      false,
    ),
    'http://127.0.0.1:9001/admin-api/users?page=1&perPage=25&q=&admin=all&suspension=all',
  );
});

test('maps a secure game socket to a secure production admin endpoint', () => {
  assert.equal(
    buildAdminApiUrl(
      'rounds/round-id',
      'wss://game.example.com/ws',
      'https://app.example.com',
      false,
    ),
    'https://game.example.com/admin-api/rounds/round-id',
  );
});
