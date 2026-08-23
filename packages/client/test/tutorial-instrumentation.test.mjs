import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('both tutorial entry paths attach lifecycle telemetry', async () => {
  const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  const game = await readFile(new URL('../src/game.ts', import.meta.url), 'utf8');
  assert.match(main, /source: 'first_time_queue'/);
  assert.match(main, /source: 'main_menu'/);
  assert.match(main, /onCompleted: \(\) => tutorialTelemetry\.complete\(\)/);
  assert.match(main, /onLeft: \(\) => tutorialTelemetry\.leave\('explicit_exit'\)/);
  assert.match(game, /options\.telemetry\?\.onStarted\(\)/);
  assert.match(game, /options\.telemetry\?\.onCompleted\(\)/);
  assert.match(
    game,
    /onExitMatch: \(\) => returnToMainMenu\(\)/,
    'the Pixi pointer event must not be interpreted as trainingComplete',
  );
  assert.match(
    main,
    /markTrainingCompleteReturn\(this\.profile\.id\);\s*window\.location\.reload\(\)/,
    'returning from queued training should always restore the schedule prompt',
  );
  assert.doesNotMatch(
    main,
    /if \(trainingComplete\) markTrainingCompleteReturn/,
  );
});

test('admin tutorials tab follows Past rounds and renders funnel details', async () => {
  const menu = await readFile(
    new URL('../src/admin/AdminMenu.ts', import.meta.url),
    'utf8',
  );
  assert.match(menu, /\['users', 'ongoing', 'past', 'tutorials'\]/);
  assert.match(menu, /Completion rate/);
  assert.match(menu, /Average elapsed/);
  assert.match(menu, /Discord \/ Google/);
  assert.match(menu, /admin-tutorial-filters/);
  const service = await readFile(
    new URL('../../server/src/adminService.ts', import.meta.url),
    'utf8',
  );
  assert.match(service, /\.order\('started_at', \{ ascending: false \}\)/);
});
