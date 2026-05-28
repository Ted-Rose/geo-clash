import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../src/gameState.js';
import { makeRoomStores } from '../src/memoryStore.js';

function makeIo() {
  const events = [];
  return {
    _events: events,
    to: () => ({ emit: (e, p) => events.push({ event: e, payload: p }) }),
    emit: (e, p) => events.push({ event: e, payload: p }),
  };
}

// Late joiner: connect mid-flight, snapshot must contain the projectile
// with original tSpawn/tArrival so the new client extrapolates the same
// position the existing clients see.
test('late-joiner snapshot includes in-flight projectile', async (t) => {
  const io = makeIo();
  const stores = makeRoomStores('late-room');
  const game = new GameState({ io, roomId: 'late-room', stores });
  t.after(() => game.endMatch());
  await game.initGrid(51.5, -0.12);
  await game.addPlayer('A', 'attacker');
  await game.addPlayer('B', 'victim');
  await game.updateLocation('A', 51.5, -0.12, 0);
  await game.updateLocation('B', 51.50004, -0.12, 0);
  game.startMatch();
  // long-range target so flight time is multiple seconds
  await game.attack('A', { target: { lat: 51.5002, lng: -0.12 } });

  // simulate ~600ms of flight time before late-joiner connects
  await new Promise((r) => setTimeout(r, 600));
  const snapshot = await game.snapshot();
  assert.ok(Array.isArray(snapshot.projectiles), 'snapshot exposes projectiles');
  assert.equal(snapshot.projectiles.length, 1, 'one projectile in flight');
  const p = snapshot.projectiles[0];
  assert.equal(p.status, 'in-flight');
  assert.ok(p.tSpawn < p.tArrival, 'tSpawn < tArrival');
  assert.ok(snapshot.serverNow >= p.tSpawn, 'serverNow >= tSpawn');
  assert.ok(snapshot.serverNow < p.tArrival, 'serverNow < tArrival (still in flight)');

  // Interpolate position from snapshot fields
  const u = (snapshot.serverNow - p.tSpawn) / (p.tArrival - p.tSpawn);
  const lat = p.origin.lat + (p.target.lat - p.origin.lat) * u;
  const lng = p.origin.lng + (p.target.lng - p.origin.lng) * u;
  // Expect lat between origin and target
  assert.ok(lat > p.origin.lat && lat < p.target.lat, 'lat between origin and target');
  // longitude is constant in this case
  assert.ok(Math.abs(lng - p.origin.lng) < 1e-9);

  // Once the projectile resolves, the next snapshot drops it
  await new Promise((r) => setTimeout(r, p.tArrival - Date.now() + 50));
  const after = await game.snapshot();
  assert.equal(after.projectiles.length, 0, 'projectile cleared after resolution');
});
