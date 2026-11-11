// Pending-clash ACK handshake for Geo Snake.
//
// The server detects a collision in _tick and pushes `clash_verify` to
// every participant, but the kill commits once the DECIDING participant
// — the killer, or the victim for killerless head-on-head clashes —
// ACKs inside CLASH_ACK_TIMEOUT_MS. The victim's ACK is advisory only:
// victim timeout or disconnect never voids a killer-acknowledged kill.
// Free functions that take the SnakeGameState instance, matching the
// collisions.js/food.js helper style; the class owns `_pendingClashes`
// (clashId → { victimId, killerId, acksNeeded: Set, timestamp }).

import { CLASH_ACK_TIMEOUT_MS } from './constants.js';

// Called when a socket ACKs a pending clash_verify.
// acksNeeded holds only the deciding participant, so the kill executes
// the moment the killer ACKs — victim ACKs are ignored.
export async function clashAck(game, socketId, clashId) {
  if (!game.matchActive) return;
  const pending = game._pendingClashes.get(clashId);
  if (!pending) return;

  pending.acksNeeded.delete(socketId);

  if (pending.acksNeeded.size === 0) {
    game._pendingClashes.delete(clashId);
    await killPlayer(game, pending.victimId, pending.killerId);
  }
}

// Called on socket disconnect — cancel pending clashes where the
// departed player was the deciding participant (the killer, or the
// victim of a killerless clash). A victim leaving a killered clash
// does NOT cancel it: the killer can still ACK and collect the kill.
export function cancelClashesFor(game, socketId) {
  for (const [clashId, entry] of game._pendingClashes) {
    if (entry.acksNeeded.has(socketId)) {
      game._pendingClashes.delete(clashId);
    }
  }
}

// Re-key pending clashes that referenced the old socket id so ACKs and
// cancelClashesFor keep working against the reconnected socket.
export function rekeyClashesFor(game, oldId, newId) {
  for (const entry of game._pendingClashes.values()) {
    if (entry.victimId === oldId) entry.victimId = newId;
    if (entry.killerId === oldId) entry.killerId = newId;
    if (entry.acksNeeded.delete(oldId)) entry.acksNeeded.add(newId);
  }
}

// Drop pending clashes whose ACK window has closed without the
// deciding participant's ACK — a killer who never ACKs voids the kill.
export function expirePendingClashes(game, now) {
  for (const [clashId, entry] of game._pendingClashes) {
    if (now - entry.timestamp > CLASH_ACK_TIMEOUT_MS) {
      game._pendingClashes.delete(clashId);
    }
  }
}

// Turn fresh collision results into pending clashes: dedup one pending
// clash per victim, register the deciding participant's ACK (the
// killer; the victim when the collision has no killer), and push
// clash_verify to every participant.
export function initiateClashes(game, kills, now) {
  for (const { killerId, victimId } of kills) {
    // Dedup: skip if a pending clash already exists for this victim.
    const alreadyPending = [...game._pendingClashes.values()].some(
      (e) => e.victimId === victimId,
    );
    if (alreadyPending) continue;

    const clashId = `${victimId}:${now}`;
    // The victim's ACK is advisory — only the decider must respond.
    const acksNeeded = new Set([killerId || victimId]);

    game._pendingClashes.set(clashId, {
      victimId,
      killerId: killerId || null,
      acksNeeded,
      timestamp: now,
    });

    // Notify all participants; the victim's reply is informational.
    game.io.to(victimId).emit('clash_verify', { clashId });
    if (killerId) game.io.to(killerId).emit('clash_verify', { clashId });
  }
}

// Commit a confirmed kill: reset the victim in place, credit the killer,
// emit snake-hit to the room and snake-reset to the victim's socket.
// A victim whose record is already gone (hard leave mid-handshake)
// cannot dodge the outcome — the killer is still credited.
export async function killPlayer(game, victimId, killerId) {
  const victim = await game.playerStore.get(victimId);
  if (victim) {
    victim.score = 0;
    victim.tailPoints = [];
    victim.spawnedAt = Date.now();
    await game.playerStore.set(victimId, victim);
  }

  let killerCredited = false;
  if (killerId) {
    const killer = await game.playerStore.get(killerId);
    if (killer) {
      killer.kills = (killer.kills || 0) + 1;
      killer.score += 5;
      await game.playerStore.set(killerId, killer);
      killerCredited = true;
    }
  }

  if (!victim && !killerCredited) return; // nothing changed — no events

  game._emit('snake-hit', { victimId, killerId: killerId || null });

  // Tell the victim's own socket to reset its local state
  if (victim) {
    game.io.to(victimId).emit('snake-reset', { spawnedAt: victim.spawnedAt });
  }
}
