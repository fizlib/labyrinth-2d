import test from 'node:test';
import assert from 'node:assert/strict';

test('completed matches atomically persist the registered and guest rosters', async (t) => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test_key_long_enough';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_key_long_enough';

  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_SECRET_KEY;
  });

  const { recordMatchResult } = await import('../dist/supabaseAdmin.js');
  const guest = {
    participantId: 'guest-seat-1',
    displayName: 'Maze Guest',
    role: 'warden',
    escaped: false,
    abandoned: false,
  };
  await recordMatchResult({
    matchId: '00000000-0000-4000-8000-000000000001',
    roomId: 'GUEST1',
    winner: 'wardens',
    playerCount: 1,
    rated: false,
    startedAt: '2026-08-23T12:00:00.000Z',
    endedAt: '2026-08-23T12:10:00.000Z',
    participants: [],
    guestParticipants: [guest],
  });

  assert.equal(requests.length, 1);
  assert.match(
    requests[0].url,
    /\/rest\/v1\/rpc\/record_match_result_with_guests$/,
  );
  const body = JSON.parse(requests[0].init.body);
  assert.deepEqual(body.p_participants, []);
  assert.deepEqual(body.p_guest_participants, [guest]);
});
