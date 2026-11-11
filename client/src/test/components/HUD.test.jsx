import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HUD from '../../components/HUD.jsx';

const leaders = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Player${i}`,
    squares: 10 - i,
    color: '#fff',
  }));

describe('clash HUD', () => {
  it('formats remaining seconds as mm:ss', () => {
    render(<HUD remainingSeconds={95} />);
    expect(screen.getByText('1:35')).toBeInTheDocument();
  });

  it('renders 0:00 when remainingSeconds is undefined', () => {
    render(<HUD />);
    expect(screen.getByText('0:00')).toBeInTheDocument();
  });

  it('renders hearts by lives and rockets by ammo', () => {
    const { container } = render(
      <HUD me={{ lives: 2 }} ammo={1} maxAmmo={3} />
    );
    const text = container.textContent;
    expect(text.match(/❤️/g)).toHaveLength(2);
    expect(text.match(/🖤/g)).toHaveLength(1);
    expect(text.match(/🚀/g)).toHaveLength(1);
    expect(text.match(/○/g)).toHaveLength(2);
  });

  it('caps the leaderboard at the top 4 rows', () => {
    const { container } = render(<HUD leaderboard={leaders(5)} />);
    expect(screen.getByText('Player3')).toBeInTheDocument();
    expect(screen.queryByText('Player4')).toBeNull();
    expect(container.querySelectorAll('ul li')).toHaveLength(4);
  });
});
