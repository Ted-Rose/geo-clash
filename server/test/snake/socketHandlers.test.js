import test from 'node:test';
import assert from 'node:assert/strict';
import { registerSnakeHandlers } from '../../src/snake/socketHandlers.js';

// Socket-level tests: fake socket captures handlers via `on()`, a recorder
// game stub verifies delegation — no real SnakeGameState needed.

function makeSocket(id = 's1') {
  return {
    id,
    data: {},
    _handlers: {},
    on(ev, fn) { this._handlers[ev] = fn; },
    join() {},
    leave() {},
  };
}

function makeGame() {
  const calls = [];
  const rec = (name) => async (...args) => { calls.push({ name, args }); };
  return {
    calls,
    updateLocation: rec('updateLocation'),
    eatFood: rec('eatFood'),
    clashAck: rec('clashAck'),
  };
}

test(
  'socket location-update: non-number/missing lat or lng ignored; ' +
    'valid payload delegates',
  async () => {
  const socket = makeSocket();
  const game = makeGame();
  registerSnakeHandlers(socket, game);
  const handler = socket._handlers['location-update'];
  assert.ok(handler, 'location-update handler registered');

  await handler({});
  await handler({ lat: 'x', lng: 2 });
  await handler({ lat: 1 }); // lng missing
  await handler(); // no payload at all
  await handler(null); // explicit null must not throw
  assert.equal(game.calls.length, 0, 'invalid payloads never reach the game');

  await handler({
    lat: 51.5,
    lng: -0.12,
    heading: 90,
    tailPoints: [{ lat: 1, lng: 2 }],
    score: 3,
  });
  assert.equal(game.calls.length, 1);
  assert.equal(game.calls[0].name, 'updateLocation');
  assert.deepEqual(
    game.calls[0].args,
    ['s1', 51.5, -0.12, 90, [{ lat: 1, lng: 2 }], 3],
    'delegates with socket.id and the full client payload',
  );
  },
);

test(
  'socket eat_food: non-string foodId ignored; valid string ' +
    'delegates to eatFood(socket.id, foodId)',
  async () => {
  const socket = makeSocket();
  const game = makeGame();
  registerSnakeHandlers(socket, game);
  const handler = socket._handlers.eat_food;
  assert.ok(handler, 'eat_food handler registered');

  await handler({ foodId: 123 });
  await handler({});
  await handler();
  await handler(null); // explicit null must not throw
  assert.equal(game.calls.length, 0, 'invalid payloads never reach the game');

  await handler({ foodId: 'f1' });
  assert.equal(game.calls.length, 1);
  assert.equal(game.calls[0].name, 'eatFood');
  assert.deepEqual(game.calls[0].args, ['s1', 'f1']);
  },
);

test(
  'socket clash_ack: non-string clashId ignored; valid string ' +
    'delegates to clashAck(socket.id, clashId)',
  async () => {
  const socket = makeSocket();
  const game = makeGame();
  registerSnakeHandlers(socket, game);
  const handler = socket._handlers.clash_ack;
  assert.ok(handler, 'clash_ack handler registered');

  await handler({ clashId: 42 });
  await handler({});
  await handler();
  await handler(null); // explicit null must not throw
  assert.equal(game.calls.length, 0, 'invalid payloads never reach the game');

  await handler({ clashId: 'victim:123' });
  assert.equal(game.calls.length, 1);
  assert.equal(game.calls[0].name, 'clashAck');
  assert.deepEqual(game.calls[0].args, ['s1', 'victim:123']);
  },
);
