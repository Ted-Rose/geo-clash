import test from 'node:test';
import assert from 'node:assert/strict';
import { registerClashHandlers } from '../../src/clash/socketHandlers.js';

function fakeSocket(id) {
  return {
    id,
    data: {},
    _h: {},
    on(ev, fn) { this._h[ev] = fn; },
  };
}

// Records { method, args } for every delegated call.
function fakeGame() {
  const calls = [];
  const rec = (m) => async (...args) => calls.push({ method: m, args });
  return {
    _calls: calls,
    updateLocation: rec('updateLocation'),
    attack: rec('attack'),
    activateShield: rec('activateShield'),
    respawn: rec('respawn'),
  };
}

test('location-update with non-number lat/lng is ignored', async () => {
  const socket = fakeSocket('s1');
  const game = fakeGame();
  registerClashHandlers(socket, game);
  const h = socket._h['location-update'];
  assert.ok(h, 'handler registered');

  await h({ lat: 'x', lng: 1 });
  await h({});
  await h(undefined);
  assert.equal(game._calls.length, 0);

  await h({ lat: 1, lng: 2, heading: 90 });
  assert.equal(game._calls.length, 1);
  assert.deepEqual(game._calls[0], {
    method: 'updateLocation',
    args: ['s1', 1, 2, 90],
  });
});

test('player-attack delegates to game.attack with socket.id and payload', async () => {
  const socket = fakeSocket('s1');
  const game = fakeGame();
  registerClashHandlers(socket, game);
  const h = socket._h['player-attack'];
  assert.ok(h, 'handler registered');

  const target = { lat: 1, lng: 2 };
  await h({ heading: 10, target });
  assert.deepEqual(game._calls[0], {
    method: 'attack',
    args: ['s1', { heading: 10, target }],
  });

  await h({});
  assert.deepEqual(game._calls[1], {
    method: 'attack',
    args: ['s1', { heading: undefined, target: undefined }],
  });
});

test('player-shield and player-respawn delegate with socket.id', async () => {
  const socket = fakeSocket('s1');
  const game = fakeGame();
  registerClashHandlers(socket, game);

  await socket._h['player-shield']();
  await socket._h['player-respawn']();
  assert.deepEqual(game._calls, [
    { method: 'activateShield', args: ['s1'] },
    { method: 'respawn', args: ['s1'] },
  ]);
});
