// Geo Snake gameplay constants. All distances in meters, times in seconds.

export const FOOD_RESPAWN_INTERVAL_MS = 2000;
export const TICK_MS = 500;

// How far behind the head to leave a "neck gap" before recording tail points.
// This prevents self-collision from GPS jitter.
export const NECK_GAP_M = 2.0;

// Minimum distance the player must move before a new tail segment is appended.
export const MIN_MOVE_M = 1.5;

// Player is considered colliding with another's tail when within this radius.
export const COLLISION_RADIUS_M = 2.5;

// When a player's head touches a food item within this radius, it eats it.
export const EAT_RADIUS_M = 4.0;

// Maximum tail history length (segment count) before trimming oldest.
export const MAX_TAIL_SEGMENTS = 200;

// Score points per food item eaten.
export const FOOD_SCORE_PER_ITEM = 1;

// How many food items exist in the arena at any time.
export const FOOD_COUNT_TARGET = 5;

// Respawn grace period (ms) during which newly spawned player is collision-safe.
export const SPAWN_GRACE_MS = 3000;

// How many kills a player needs to win (0 = time-based only).
export const KILL_WIN_THRESHOLD = 0;

export const COLORS = [
  '#ef4444',
  '#3b82f6',
  '#22c55e',
  '#eab308',
  '#a855f7',
  '#ec4899',
  '#06b6d4',
  '#f97316',
];
