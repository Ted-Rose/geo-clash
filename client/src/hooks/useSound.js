import { useRef, useCallback } from 'react';

function getAudioContext(ref) {
  if (!ref.current) {
    ref.current = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (ref.current.state === 'suspended') {
    ref.current.resume().catch(() => {});
  }
  return ref.current;
}

export function useSound() {
  const ctxRef = useRef(null);

  const playEat = useCallback(() => {
    try {
      const ac = getAudioContext(ctxRef);
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(
        880,
        ac.currentTime + 0.1
      );
      gain.gain.setValueAtTime(0.25, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.15);
      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + 0.15);
    } catch (_) {}
  }, []);

  const playDie = useCallback(() => {
    try {
      const ac = getAudioContext(ctxRef);
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(280, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(
        55,
        ac.currentTime + 0.5
      );
      gain.gain.setValueAtTime(0.35, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.5);
      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + 0.5);
    } catch (_) {}
  }, []);

  const playCaptureStart = useCallback(() => {
    try {
      const ac = getAudioContext(ctxRef);
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.type = 'square';
      osc.frequency.setValueAtTime(700, ac.currentTime);
      gain.gain.setValueAtTime(0.12, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.09);
      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + 0.09);
    } catch (_) {}
  }, []);

  const playCaptureOwned = useCallback(() => {
    try {
      const ac = getAudioContext(ctxRef);
      [523, 659, 784, 1047].forEach((freq, i) => {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.type = 'sine';
        const t = ac.currentTime + i * 0.075;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.28, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        osc.start(t);
        osc.stop(t + 0.18);
      });
    } catch (_) {}
  }, []);

  return { playEat, playDie, playCaptureStart, playCaptureOwned };
}
