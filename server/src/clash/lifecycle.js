// Match teardown for Geo Clash: stop timers, archive scores to the
// leaderboard, purge room stores, emit match-end.
// Takes the GameState instance — the class keeps the method surface.

import { leaderboardStore } from '../shared/memoryStore.js';
import { recountScores, scores } from './capture.js';

// Idempotent match end. Flips status to 'ending', clears tick/ammo/
// projectile timers, archives per-player square counts, purges the room
// stores, then emits the final scores + leaderboard.
export async function endMatch(state) {
  if (state.status === 'ending' || state.status === 'ended') return;
  state.status = 'ending';
  state.matchActive = false;
  if (state._tickHandle) {
    clearInterval(state._tickHandle);
    state._tickHandle = null;
  }
  if (state._projectileTimers) {
    for (const h of state._projectileTimers.values()) clearTimeout(h);
    state._projectileTimers.clear();
  }
  if (state._ammoTimers) {
    for (const rec of state._ammoTimers.values()) {
      clearTimeout(rec.handle);
    }
    state._ammoTimers.clear();
  }

  // Refresh the score caches before the purge so the match-end payload
  // carries real scores even when no tick/snapshot ran since the last
  // ownership change (scores() reads the caches, not the stores).
  await recountScores(state);

  let archived = [];
  try {
    const players = (await state.playerStore.all()).map(([, p]) => p);
    const cells = (await state.gridStore.all()).map(([, c]) => c);
    const matchId = `${state.roomId}:${Date.now()}`;
    for (const p of players) {
      const squares = cells.filter((c) => c.ownerId === p.id).length;
      await leaderboardStore.archive({
        playerId: p.id,
        matchId,
        name: p.name,
        color: p.color,
        score: squares,
        metric: 'squares',
        gameType: 'clash',
        finishedAt: Date.now(),
        roomName: state.roomName,
      });
      archived.push({
        id: p.id,
        name: p.name,
        color: p.color,
        squares,
      });
    }
    archived.sort((a, b) => b.squares - a.squares);
  } catch (err) {
    console.error('[clash/lifecycle] archive error:', err.message);
  }

  try {
    await Promise.all([
      state.playerStore.clear?.(),
      state.gridStore.clear?.(),
      state.projectileStore?.clear?.(),
    ]);
  } catch (err) {
    console.error('[clash/lifecycle] purge error:', err.message);
  }

  state._emit('match-end', { scores: scores(state), leaderboard: archived });
  state.status = 'ended';
  state._onEnd?.();
}
