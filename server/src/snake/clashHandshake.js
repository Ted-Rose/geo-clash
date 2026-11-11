// Pending-clash ACK handshake for Geo Snake.
//
// The server detects a collision in _tick and pushes `clash_verify` to
// every participant. Kills with a killer commit once the KILLER ACKs
// inside CLASH_ACK_TIMEOUT_MS; the victim's ACK is advisory only and
// its timeout or disconnect never voids a killer-acknowledged kill.
// Killerless kills (mutual head-on-head, killerId null) have no
// decider, so they commit AT DETECTION — going dark can never dodge
// the death. Free functions that take the SnakeGameState instance,
// matching the collisions.js/food.js helper style; the class owns
// `_pendingClashes`
// (clashId → { victimId, killerId, acksNeeded: Set, timestamp }).

import { CLASH_ACK_TIMEOUT_MS } from './constants.js';

// Called when a socket ACKs a pending clash_verify.
// acksNeeded holds only the deciding participant, so the kill executes
// the moment the killer ACKs — victim ACKs are ignored.
export async function clashAck(game, socketId, clashId) {
  if (!game.matchActive) return;
  const pending = game._pendingClashes.get(clashId);
  if (!pending) return;

  // An ACK landing after the window closed but before the next tick's
  // expiry sweep must not commit — treat the clash as expired.
  if (Date.now() - pending.timestamp > CLASH_ACK_TIMEOUT_MS) {
    game._pendingClashes.delete(clashId);
    return;
  }

  pending.acksNeeded.delete(socketId);

  if (pending.acksNeeded.size === 0) {
    game._pendingClashes.delete(clashId);
    await killPlayer(game, pending.victimId, pending.killerId);
  }
}

// Called on socket disconnect — cancel pending clashes where the
// departed player was the deciding participant (the killer; killerless
// kills commit at detection and never become pending). A victim
// leaving a killered clash does NOT cancel it: the killer can still
// ACK and collect the kill.
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

// Turn fresh collision results into outcomes: dedup one clash per
// victim per tick, push clash_verify to every participant, then either
// commit the kill at detection (killerless mutual head-on-head — no
// decider exists and the victim's ack was only advisory, so waiting
// would let a hard leave dodge the death) or register a pending clash
// that waits on the killer's ACK. Acks for already-committed clashes
// are harmless no-ops.
export async function initiateClashes(game, kills, now) {
  const seenVictims = new Set();
  for (const { killerId, victimId } of kills) {
    // Dedup: one outcome per victim — skip duplicates in this batch and
    // any pending clash already registered for the victim.
    if (seenVictims.has(victimId)) continue;
    const alreadyPending = [...game._pendingClashes.values()].some(
      (e) => e.victimId === victimId,
    );
    if (alreadyPending) continue;
    seenVictims.add(victimId);

    const clashId = `${victimId}:${now}`;

    // Notify all participants; the victim's reply is informational.
    game.io.to(victimId).emit('clash_verify', { clashId });
    if (killerId) game.io.to(killerId).emit('clash_verify', { clashId });

    if (!killerId) {
      await killPlayer(game, victimId, null);
      continue;
    }

    // The victim's ACK is advisory — only the killer must respond.
    game._pendingClashes.set(clashId, {
      victimId,
      killerId,
      acksNeeded: new Set([killerId]),
      timestamp: now,
    });
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
