import { describe, it, expect } from 'vitest';
import { render, screen, renderHook } from '@testing-library/react';
import SnakeHUD, { formatTime, useCountdown } from '../../snake/HUD.jsx';

describe('formatTime', () => {
  it('renders m:ss with ceil rounding', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(61_000)).toBe('1:01');
    expect(formatTime(59_900)).toBe('1:00');
    expect(formatTime(30 * 60 * 1000)).toBe('30:00');
  });
});

describe('useCountdown', () => {
  it('returns null without timeLimitMs or matchStartAt', () => {
    expect(renderHook(() => useCountdown(0, Date.now())).result.current).toBeNull();
    expect(
      renderHook(() => useCountdown(60_000, null)).result.current
    ).toBeNull();
  });

  it('counts down from matchStartAt', () => {
    const { result } = renderHook(() =>
      useCountdown(60_000, Date.now() - 30_000)
    );
    expect(result.current).toBeGreaterThan(28_000);
    expect(result.current).toBeLessThanOrEqual(30_000);
  });

  it('clamps to 0 when the start is already past the limit', () => {
    const { result } = renderHook(() =>
      useCountdown(60_000, Date.now() - 90_000)
    );
    expect(result.current).toBe(0);
  });
});

describe('SnakeHUD', () => {
  const players = [{ id: 'a', alive: true }];
  const scores = { a: { name: 'A', score: 2, color: '#fff' } };

  it('shows no Time box without a time limit', () => {
    render(
      <SnakeHUD players={players} scores={scores} myId="a" timeLimitMs={0} />
    );
    expect(screen.queryByText('Time')).toBeNull();
    expect(screen.getByText('Score')).toBeInTheDocument();
  });

  it('shows a Time box counting down when a limit is set', () => {
    render(
      <SnakeHUD
        players={players}
        scores={scores}
        myId="a"
        timeLimitMs={60_000}
        matchStartAt={Date.now() - 59_000}
      />
    );
    expect(screen.getByText('Time')).toBeInTheDocument();
    expect(screen.getByText('0:01')).toBeInTheDocument();
  });
});
