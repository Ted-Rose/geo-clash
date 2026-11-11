import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import ControlPanel from '../../components/ControlPanel.jsx';

function baseProps(overrides = {}) {
  return {
    me: { lives: 3 },
    atBase: false,
    shieldUntil: 0,
    onAttack: vi.fn(),
    onShield: vi.fn(),
    onRespawn: vi.fn(),
    ammo: null,
    maxAmmo: null,
    ...overrides,
  };
}

function motion(mag) {
  const e = new Event('devicemotion');
  e.accelerationIncludingGravity = { x: mag, y: 0, z: 0 };
  act(() => window.dispatchEvent(e));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shake detector', () => {
  it('fires onAttack once for 3 shakes in 1200 ms, with 800 ms cooldown', () => {
    let now = 10_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const onAttack = vi.fn();
    render(<ControlPanel {...baseProps({ onAttack })} />);

    motion(25); // t=10000
    now = 10_100;
    motion(25);
    now = 10_200;
    motion(25);
    expect(onAttack).toHaveBeenCalledTimes(1);

    // A second full burst inside the 800 ms cooldown is suppressed.
    now = 10_300;
    motion(25);
    now = 10_400;
    motion(25);
    now = 10_500;
    motion(25);
    expect(onAttack).toHaveBeenCalledTimes(1);

    // Shakes spaced more than 1200 ms apart never reach 3 in-window.
    now = 13_000;
    motion(25);
    now = 15_000;
    motion(25);
    now = 17_000;
    motion(25);
    expect(onAttack).toHaveBeenCalledTimes(1);

    // Weak shakes are ignored entirely.
    now = 18_000;
    motion(20);
    now = 18_100;
    motion(20);
    now = 18_200;
    motion(20);
    expect(onAttack).toHaveBeenCalledTimes(1);

    // After the cooldown a fresh burst fires again.
    now = 20_000;
    motion(25);
    now = 20_100;
    motion(25);
    now = 20_200;
    motion(25);
    expect(onAttack).toHaveBeenCalledTimes(2);
  });
});

describe('rendering', () => {
  it('shows GO TO BASE / RESPAWN when lives ≤ 0, gated on atBase', () => {
    const onRespawn = vi.fn();
    const { rerender } = render(
      <ControlPanel {...baseProps({ me: { lives: 0 }, onRespawn })} />
    );
    const goToBase = screen.getByText('GO TO BASE').closest('button');
    expect(goToBase).toBeDisabled();

    rerender(
      <ControlPanel
        {...baseProps({ me: { lives: 0 }, atBase: true, onRespawn })}
      />
    );
    const respawn = screen.getByText('📡 RESPAWN').closest('button');
    expect(respawn).toBeEnabled();
    respawn.click();
    expect(onRespawn).toHaveBeenCalledTimes(1);
  });

  it('shows the shield countdown and disables SHIELD while active', async () => {
    render(
      <ControlPanel {...baseProps({ shieldUntil: Date.now() + 2000 })} />
    );
    expect(await screen.findByText(/🛡 Shield/)).toBeInTheDocument();
    expect(screen.getByText('🛡 SHIELD').closest('button')).toBeDisabled();
  });

  it('disables FIRE when out of ammo', () => {
    render(<ControlPanel {...baseProps({ ammo: 0, maxAmmo: 3 })} />);
    expect(
      screen.getByText(/FIRE ROCKET/).closest('button')
    ).toBeDisabled();
  });
});
