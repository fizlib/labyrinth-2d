import assert from 'node:assert/strict';
import test from 'node:test';

import {
  areAllAudioMuted,
  loadAudioPreferences,
  saveMusicMutedPreference,
  saveSoundEffectsMutedPreference,
} from '../dist/systems/AudioToggle.js';

function withLocalStorage(initialValues, callback) {
  const values = new Map(Object.entries(initialValues));
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };

  try {
    callback(values);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

test('migrates the legacy master mute preference to both audio channels', () => {
  withLocalStorage({ 'labyrinth-audio-muted': '1' }, () => {
    assert.deepEqual(loadAudioPreferences(), {
      musicMuted: true,
      soundEffectsMuted: true,
    });
  });
});

test('loads and saves music and sound-effect preferences independently', () => {
  withLocalStorage(
    {
      'labyrinth-audio-muted': '1',
      'labyrinth-music-muted': '0',
      'labyrinth-sound-effects-muted': '1',
    },
    (values) => {
      assert.deepEqual(loadAudioPreferences(), {
        musicMuted: false,
        soundEffectsMuted: true,
      });

      saveMusicMutedPreference(true);
      saveSoundEffectsMutedPreference(false);
      assert.equal(values.get('labyrinth-music-muted'), '1');
      assert.equal(values.get('labyrinth-sound-effects-muted'), '0');
    },
  );
});

test('reports the master toggle muted only when both channels are muted', () => {
  assert.equal(areAllAudioMuted({ musicMuted: true, soundEffectsMuted: true }), true);
  assert.equal(areAllAudioMuted({ musicMuted: true, soundEffectsMuted: false }), false);
  assert.equal(areAllAudioMuted({ musicMuted: false, soundEffectsMuted: true }), false);
});
