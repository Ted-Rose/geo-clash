// Combat lifecycle for Geo Clash: fire → ammo recharge → projectile
// resolution. Free functions that take the GameState instance — the class
// keeps store/timer ownership and emits; this module owns the rules.

import { distanceMeters } from '../shared/gridUtils.js';
import {
  spawnProjectile,
  targetFromHeading,
  PROJECTILE_VMPS,
  HIT_RADIUS_M,
  ATTACK_RANGE_M as PROJECTILE_RANGE_M,
} from './projectiles.js';

const ATTACK_CONE_DEG = 25;

// Fire a projectile at an explicit target (clamped to range) or auto-aim
// at the nearest enemy inside the attack cone. Decrements ammo and
// schedules a recharge when the room has an ammo limit.
export async function attack(state, id, { heading, target } = {}) {
  if (state.status === 'ending' || state.status === 'ended') return;
  const attacker = await state.playerStore.get(id);
  if (!attacker || !attacker.alive) return;
  if (state.maxAmmo !== null) {
    const cur = attacker.ammo ?? state.maxAmmo;
    if (cur <= 0) return;
    attacker.ammo = cur - 1;
    await state.playerStore.set(id, attacker);
    state.io.to(id).emit('ammo-update', {
      ammo: attacker.ammo, maxAmmo: state.maxAmmo,
    });
    scheduleAmmoRecharge(state, id);
  }
  const dir = typeof heading === 'number' ? heading : attacker.heading || 0;

  let resolvedTarget;
  if (target && typeof target.lat === 'number'
      && typeof target.lng === 'number') {
    const dist = distanceMeters(attacker, target);
    if (dist > PROJECTILE_RANGE_M) {
      const scale = PROJECTILE_RANGE_M / dist;
      resolvedTarget = {
        lat: attacker.lat + (target.lat - attacker.lat) * scale,
        lng: attacker.lng + (target.lng - attacker.lng) * scale,
      };
    } else {
      resolvedTarget = { lat: target.lat, lng: target.lng };
    }
  } else {
    let bestEnemy = null;
    let bestDist = Infinity;
    for (const [, p] of await state.playerStore.all()) {
      if (p.id === id || !p.alive) continue;
      const d = distanceMeters(attacker, p);
      if (d > PROJECTILE_RANGE_M) continue;
      const bearing = bearingDeg(attacker, p);
      const delta = Math.abs(angleDelta(bearing, dir));
      if (delta <= ATTACK_CONE_DEG && d < bestDist) {
        bestDist = d;
        bestEnemy = p;
      }
    }
    resolvedTarget = bestEnemy
      ? { lat: bestEnemy.lat, lng: bestEnemy.lng }
      : targetFromHeading(attacker, dir, PROJECTILE_RANGE_M);
  }

  const proj = spawnProjectile({
    attacker, target: resolvedTarget, vMps: PROJECTILE_VMPS,
  });
  await state.projectileStore.set(proj.id, proj);
  state._emit('projectile-spawn', proj);
  scheduleResolution(state, proj);
}

// Restore one ammo point after ammoRenewalMs. The record's playerId is
// resolved at fire time so a recharge scheduled before a reconnect still
// mutates (and emits to) the re-keyed socket id.
export function scheduleAmmoRecharge(state, playerId) {
  const key = `${playerId}:${Date.now()}:${Math.random()}`;
  const rec = { playerId, handle: null };
  rec.handle = setTimeout(async () => {
    state._ammoTimers?.delete(key);
    if (state.maxAmmo === null) return;
    const id = rec.playerId; // resolved at fire time, not schedule time
    const p = await state.playerStore.get(id);
    if (!p) return;
    p.ammo = Math.min(state.maxAmmo, (p.ammo ?? 0) + 1);
    await state.playerStore.set(id, p);
    state.io.to(id).emit('ammo-update', {
      ammo: p.ammo, maxAmmo: state.maxAmmo,
    });
  }, state.ammoRenewalMs);
  if (typeof rec.handle.unref === 'function') rec.handle.unref();
  state._ammoTimers.set(key, rec);
}

// Resolve the projectile at its scheduled arrival time.
export function scheduleResolution(state, proj) {
  const delay = Math.max(0, proj.tArrival - Date.now());
  const handle = setTimeout(() => {
    state._projectileTimers?.delete(proj.id);
    resolveProjectile(state, proj.id).catch((err) => {
      console.error('[clash/combat] resolve error:', err.message);
    });
  }, delay);
  if (typeof handle.unref === 'function') handle.unref();
  state._projectileTimers.set(proj.id, handle);
}

// Find the closest live enemy within the hit radius of the projectile's
// target; apply shield/block/hit outcome and emit the result.
export async function resolveProjectile(state, projectileId) {
  if (state.status === 'ending' || state.status === 'ended') return;
  const proj = await state.projectileStore.get(projectileId);
  if (!proj || proj.status !== 'in-flight') return;
  const now = Date.now();

  let victim = null;
  let bestDist = Infinity;
  for (const [, p] of await state.playerStore.all()) {
    if (p.id === proj.attackerId || !p.alive) continue;
    const d = distanceMeters(proj.target, p);
    if (d <= HIT_RADIUS_M && d < bestDist) {
      bestDist = d;
      victim = p;
    }
  }

  let outcome = 'expired';
  let victimId = null;
  if (victim) {
    victimId = victim.id;
    const shielded = victim.shieldActive && victim.shieldUntil > now;
    if (shielded) {
      outcome = 'blocked';
    } else {
      outcome = 'hit';
      victim.lives = Math.max(0, victim.lives - 1);
      if (victim.lives === 0) victim.alive = false;
      await state.playerStore.set(victim.id, victim);
      state._emit('player-hit', {
        id: victim.id,
        lives: victim.lives,
        alive: victim.alive,
      });
    }
  }

  proj.status = outcome;
  await state.projectileStore.del(projectileId);
  state._emit('projectile-resolved', { id: proj.id, outcome, victimId });
}

function bearingDeg(from, to) {
  const φ1 = from.lat * Math.PI / 180;
  const φ2 = to.lat * Math.PI / 180;
  const λ1 = from.lng * Math.PI / 180;
  const λ2 = to.lng * Math.PI / 180;
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function angleDelta(a, b) {
  let d = ((a - b + 540) % 360) - 180;
  return d;
}
