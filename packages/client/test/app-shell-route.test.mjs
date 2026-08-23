import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAppShellRoute,
  getAppShellRoutePath,
  preservesViewDuringSessionRefresh,
} from '../dist/navigation/AppShellRoute.js';

test('recognizes direct admin links with or without a trailing slash', () => {
  assert.equal(getAppShellRoute('/admin'), 'admin');
  assert.equal(getAppShellRoute('/admin/'), 'admin');
});

test('does not treat similarly named public paths as the admin route', () => {
  assert.equal(getAppShellRoute('/'), 'menu');
  assert.equal(getAppShellRoute('/administrator'), 'menu');
  assert.equal(getAppShellRoute('/admin/users'), 'menu');
});

test('maps shell routes to their canonical browser paths', () => {
  assert.equal(getAppShellRoutePath('menu'), '/');
  assert.equal(getAppShellRoutePath('admin'), '/admin');
});

test('keeps the admin console mounted during tab-focus session events', () => {
  assert.equal(preservesViewDuringSessionRefresh('admin'), true);
  assert.equal(preservesViewDuringSessionRefresh('profile'), true);
  assert.equal(preservesViewDuringSessionRefresh('menu'), false);
});
