import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('tutorial analytics persist verified players and protected guest attempts', async (t) => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test_key_long_enough';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_key_long_enough';

  const originalFetch = globalThis.fetch;
  const requests = [];
  let selectedRow = null;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    const method = init.method ?? 'GET';
    requests.push({ url: href, init: { ...init, method } });
    if (href.endsWith('/auth/v1/user')) {
      return Response.json({ id: '00000000-0000-4000-8000-000000000001' });
    }
    if (href.includes('/rest/v1/profiles')) {
      return Response.json([
        { display_name: 'Verified Player', is_admin: false, suspended_at: null },
      ]);
    }
    if (href.includes('/rest/v1/player_stats')) {
      return Response.json([{ rating: 1200, rated_matches: 0 }]);
    }
    if (href.includes('/rest/v1/tutorial_sessions') && method === 'GET') {
      return Response.json(selectedRow ? [selectedRow] : []);
    }
    if (href.includes('/rest/v1/tutorial_sessions') && method === 'POST') {
      return new Response(null, { status: 201 });
    }
    if (href.includes('/rest/v1/tutorial_sessions') && method === 'PATCH') {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${method} ${href}`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_SECRET_KEY;
  });

  const { createTutorialSession, isValidTutorialUpdateToken, updateTutorialSession } =
    await import('../dist/tutorialService.js');
  const guestCredential = await createTutorialSession(null, {
    source: 'first_time_queue',
    guestId: 'guest:test-session',
    displayName: 'Guest Explorer',
  });
  const guestInsert = requests.find(
    (request) =>
      request.url.includes('/rest/v1/tutorial_sessions') &&
      request.init.method === 'POST',
  );
  const guestBody = JSON.parse(guestInsert.init.body);
  assert.equal(guestBody.participant_id, 'guest:test-session');
  assert.equal(guestBody.is_guest, true);
  assert.equal(guestBody.source, 'first_time_queue');
  assert.equal(guestBody.update_token_hash.length, 64);
  assert.equal(
    isValidTutorialUpdateToken(guestCredential.updateToken, guestBody.update_token_hash),
    true,
  );
  assert.equal(
    isValidTutorialUpdateToken('wrong-token', guestBody.update_token_hash),
    false,
  );

  selectedRow = {
    id: guestCredential.id,
    status: 'left',
    started_at: '2026-08-23T12:00:00.000Z',
    update_token_hash: guestBody.update_token_hash,
    reminder_opened_at: null,
    discord_reminder_clicked_at: null,
    google_calendar_clicked_at: null,
  };
  requests.length = 0;
  await updateTutorialSession(guestCredential.id, {
    event: 'reminder_clicked',
    provider: 'discord',
    updateToken: guestCredential.updateToken,
  });
  const leftReminderPatch = requests.find(
    (request) => request.init.method === 'PATCH',
  );
  const leftReminderBody = JSON.parse(leftReminderPatch.init.body);
  assert.equal(typeof leftReminderBody.discord_reminder_clicked_at, 'string');
  assert.equal(
    Object.hasOwn(leftReminderBody, 'status'),
    false,
    'a reminder click must not rewrite a left attempt as completed',
  );

  requests.length = 0;
  await createTutorialSession('valid-player-access-token-long-enough', {
    source: 'main_menu',
    guestId: 'guest:spoofed',
    displayName: 'Spoofed Name',
  });
  const authenticatedInsert = requests.find(
    (request) =>
      request.url.includes('/rest/v1/tutorial_sessions') &&
      request.init.method === 'POST',
  );
  const authenticatedBody = JSON.parse(authenticatedInsert.init.body);
  assert.equal(authenticatedBody.profile_id, '00000000-0000-4000-8000-000000000001');
  assert.equal(authenticatedBody.participant_id, authenticatedBody.profile_id);
  assert.equal(authenticatedBody.display_name, 'Verified Player');
  assert.equal(authenticatedBody.is_guest, false);

  requests.length = 0;
  selectedRow = {
    id: guestCredential.id,
    status: 'left',
    started_at: '2026-08-23T12:00:00.000Z',
    update_token_hash: guestBody.update_token_hash,
    reminder_opened_at: null,
    discord_reminder_clicked_at: null,
    google_calendar_clicked_at: null,
  };
  await updateTutorialSession(guestCredential.id, {
    event: 'completed',
    updateToken: guestCredential.updateToken,
  });
  const completionPatch = requests.find(
    (request) =>
      request.url.includes('/rest/v1/tutorial_sessions') &&
      request.init.method === 'PATCH',
  );
  const completionBody = JSON.parse(completionPatch.init.body);
  assert.equal(completionBody.status, 'completed');
  assert.equal(completionBody.departure_reason, null);
  assert.ok(completionBody.duration_ms >= 0);

  await assert.rejects(
    updateTutorialSession(guestCredential.id, {
      event: 'heartbeat',
      updateToken: 'invalid-update-token-that-is-long-enough',
    }),
    (error) => error.code === 'INVALID_TUTORIAL_UPDATE_TOKEN',
  );

  selectedRow = {
    ...selectedRow,
    status: 'completed',
    reminder_opened_at: '2026-08-23T12:02:00.000Z',
  };
  requests.length = 0;
  await updateTutorialSession(guestCredential.id, {
    event: 'reminder_opened',
    updateToken: guestCredential.updateToken,
  });
  assert.equal(
    requests.some((request) => request.init.method === 'PATCH'),
    false,
    'an existing first-click timestamp must not be replaced',
  );

  await updateTutorialSession(guestCredential.id, {
    event: 'reminder_clicked',
    provider: 'discord',
    updateToken: guestCredential.updateToken,
  });
  const reminderPatch = requests.find((request) => request.init.method === 'PATCH');
  assert.equal(
    typeof JSON.parse(reminderPatch.init.body).discord_reminder_clicked_at,
    'string',
  );

  const { registerTutorialApi } = await import('../dist/tutorialApi.js');
  let routeHandler;
  registerTutorialApi({
    any(route, handler) {
      assert.equal(route, '/tutorial-api/*');
      routeHandler = handler;
    },
  });

  let requestActive = true;
  let receiveBody;
  let responseStatus = '';
  let responseBody = '';
  let finishResponse;
  const responseFinished = new Promise((resolve) => {
    finishResponse = resolve;
  });
  const response = {
    onAborted() {},
    onData(handler) {
      receiveBody = handler;
    },
    cork(handler) {
      handler();
    },
    writeStatus(status) {
      responseStatus = status;
      return this;
    },
    writeHeader() {
      return this;
    },
    end(body = '') {
      responseBody = body;
      finishResponse();
    },
  };
  const request = {
    getMethod() {
      assert.equal(requestActive, true, 'HttpRequest was read after the route returned');
      return 'post';
    },
    getUrl() {
      assert.equal(requestActive, true, 'HttpRequest was read after the route returned');
      return '/tutorial-api/sessions';
    },
    getHeader(name) {
      assert.equal(requestActive, true, 'HttpRequest was read after the route returned');
      if (name === 'host') return 'localhost:5173';
      return '';
    },
  };

  routeHandler(response, request);
  requestActive = false;
  receiveBody(
    Buffer.from(
      JSON.stringify({
        source: 'main_menu',
        guestId: 'guest:request-lifetime-test',
        displayName: 'Request Lifetime Guest',
      }),
    ),
    true,
  );
  await responseFinished;
  assert.equal(responseStatus, '201 Created');
  assert.equal(typeof JSON.parse(responseBody).updateToken, 'string');
});

test('tutorial statistic mapping uses finalized attempts for completion rate', async () => {
  const { mapTutorialStatistics } = await import('../dist/adminService.js');
  assert.deepEqual(
    mapTutorialStatistics({
      attempts: 12,
      unique_people: 9,
      in_progress: 2,
      completed: 8,
      left_count: 2,
      average_duration_ms: 71_250.4,
      reminder_opened: 5,
      discord_reminder_clicked: 3,
      google_calendar_clicked: 2,
    }),
    {
      attempts: 12,
      uniquePeople: 9,
      inProgress: 2,
      completed: 8,
      left: 2,
      completionRate: 0.8,
      averageDurationMs: 71_250,
      reminderOpened: 5,
      discordReminderClicked: 3,
      googleCalendarClicked: 2,
    },
  );
});

test('tutorial migration protects rows and finalizes stale attempts at last activity', async () => {
  const migration = await readFile(
    new URL(
      '../../../supabase/migrations/20260823150000_add_tutorial_analytics.sql',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(
    migration,
    /alter table public\.tutorial_sessions enable row level security/i,
  );
  assert.match(
    migration,
    /revoke all on table public\.tutorial_sessions from public, anon, authenticated/i,
  );
  assert.match(migration, /status = 'left'[\s\S]+ended_at = last_activity_at/i);
  assert.match(migration, /reminder_opened_at is not null/i);
});
