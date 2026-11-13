import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GameMenu from '../../shared/GameMenu.jsx';

const players = [
  { id: 'a', name: 'Ana', color: '#f00', score: 2 },
  { id: 'b', name: 'Bob', color: '#0f0', score: 5 },
];

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
}

describe('GameMenu', () => {
  it('opens on burger click and lists players sorted by score', () => {
    render(<GameMenu onLeave={vi.fn()} players={players} myId="a" />);
    expect(screen.queryByText('Players')).toBeNull();

    openMenu();
    const rows = screen
      .getAllByText(/Ana|Bob/)
      .map((el) => el.textContent);
    expect(screen.getByText('Players')).toBeInTheDocument();
    expect(rows).toEqual(['Bob', 'Ana']);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('(you)')).toBeInTheDocument();
  });

  it('calls onLeave and closes when Leave is clicked', () => {
    const onLeave = vi.fn();
    render(<GameMenu onLeave={onLeave} players={players} myId="a" />);
    openMenu();
    fireEvent.click(screen.getByText('⤺ Leave'));
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Players')).toBeNull();
  });

  it('closes when the click-outside overlay is clicked', () => {
    render(<GameMenu onLeave={vi.fn()} players={players} />);
    openMenu();
    expect(screen.getByText('Players')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('menu-overlay'));
    expect(screen.queryByText('Players')).toBeNull();
  });

  it('renders per-game children between Leave and the player list', () => {
    render(
      <GameMenu onLeave={vi.fn()} players={players}>
        <div>game specific</div>
      </GameMenu>
    );
    openMenu();
    expect(screen.getByText('game specific')).toBeInTheDocument();
  });

  it('closes on a second burger click', () => {
    render(<GameMenu onLeave={vi.fn()} players={players} />);
    openMenu();
    openMenu();
    expect(screen.queryByText('Players')).toBeNull();
  });

  it('stays open when clicking inside the menu', () => {
    render(<GameMenu onLeave={vi.fn()} players={players} />);
    openMenu();
    fireEvent.click(screen.getByText('Players'));
    expect(screen.getByText('Players')).toBeInTheDocument();
  });

  it('omits the Players section when the list is empty', () => {
    render(<GameMenu onLeave={vi.fn()} players={[]} />);
    openMenu();
    expect(screen.queryByText('Players')).toBeNull();
    expect(screen.getByText('⤺ Leave')).toBeInTheDocument();
  });

  it('dims dead players', () => {
    render(
      <GameMenu
        onLeave={vi.fn()}
        players={[{ id: 'x', name: 'X', alive: false, score: 1 }]}
      />
    );
    openMenu();
    expect(screen.getByText('X').closest('div').className).toContain(
      'opacity-50'
    );
  });
});
