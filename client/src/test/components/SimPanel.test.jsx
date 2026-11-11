import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import SimPanel from '../../components/SimPanel.jsx';

const STEP = 0.00005;

function baseProps(overrides = {}) {
  return {
    simPos: { lat: 52, lng: 13, heading: 0 },
    setSimPos: vi.fn(),
    onSpawnBot: vi.fn(),
    botCount: 0,
    onAttackAtTarget: vi.fn(),
    hasTarget: false,
    ...overrides,
  };
}

function key(k) {
  act(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k }))
  );
}

describe('SimPanel WASD movement', () => {
  it('nudges simPos by step and sets a cardinal heading', () => {
    const setSimPos = vi.fn();
    render(<SimPanel {...baseProps({ setSimPos })} />);

    key('w');
    expect(setSimPos).toHaveBeenLastCalledWith({
      lat: 52 + STEP,
      lng: 13,
      heading: 0,
    });

    key('d');
    expect(setSimPos).toHaveBeenLastCalledWith({
      lat: 52,
      lng: 13 + STEP,
      heading: 90,
    });

    key('s');
    expect(setSimPos).toHaveBeenLastCalledWith({
      lat: 52 - STEP,
      lng: 13,
      heading: 180,
    });

    key('a');
    expect(setSimPos).toHaveBeenLastCalledWith({
      lat: 52,
      lng: 13 - STEP,
      heading: 270,
    });
    expect(setSimPos).toHaveBeenCalledTimes(4);
  });

  it('ignores unmapped keys and a null simPos', () => {
    const setSimPos = vi.fn();
    const { rerender } = render(
      <SimPanel {...baseProps({ setSimPos })} />
    );
    key('x');
    expect(setSimPos).not.toHaveBeenCalled();

    rerender(<SimPanel {...baseProps({ setSimPos, simPos: null })} />);
    key('w');
    expect(setSimPos).not.toHaveBeenCalled();
  });
});
