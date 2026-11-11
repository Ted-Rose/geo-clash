import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PostMatchScreen from '../../clash/PostMatchScreen.jsx';

const match = [
  { id: 'a', name: 'Winner', squares: 12, color: '#f00' },
  { id: 'b', name: 'Second', squares: 8, color: '#0f0' },
];

describe('PostMatchScreen', () => {
  it('shows the winner and match table', () => {
    render(
      <PostMatchScreen
        finalLeaderboard={match}
        globalTop={null}
        onLeave={vi.fn()}
      />
    );
    // Winner name appears in the 🏆 heading and in the match table.
    expect(screen.getAllByText('Winner')).toHaveLength(2);
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows the empty state when globalTop is []', () => {
    render(
      <PostMatchScreen
        finalLeaderboard={match}
        globalTop={[]}
        onLeave={vi.fn()}
      />
    );
    expect(screen.getByText('No scores archived yet.')).toBeInTheDocument();
  });

  it('renders globalTop rows with squaresCaptured ?? squares fallback', () => {
    render(
      <PostMatchScreen
        finalLeaderboard={match}
        globalTop={[
          { playerId: 'x', name: 'X', squaresCaptured: 30 },
          { playerId: 'y', name: 'Y', squares: 20 },
          { playerId: 'z' },
        ]}
        onLeave={vi.fn()}
      />
    );
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('z')).toBeInTheDocument();
  });

  it('does not crash without a finalLeaderboard', () => {
    const { container } = render(
      <PostMatchScreen globalTop={[]} onLeave={vi.fn()} />
    );
    expect(container).toBeTruthy();
    expect(screen.getByText('Match over')).toBeInTheDocument();
  });
});
