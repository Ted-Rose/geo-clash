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

  const playShoot = useCallback((attackerId = '') => {
    try {
      const ac = getAudioContext(ctxRef);
      const freq = idToFreq(attackerId, 320, 720);
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(
        freq * 0.35,
        ac.currentTime + 0.18
      );
      gain.gain.setValueAtTime(0.3, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.18);
      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + 0.18);
    } catch (_) {}
  }, []);

  const playEnemyShoot = useCallback((attackerId = '') => {
    try {
      const ac = getAudioContext(ctxRef);
      const freq = idToFreq(attackerId, 320, 720);
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq * 1.25, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(
        freq * 0.45,
        ac.currentTime + 0.22
      );
      gain.gain.setValueAtTime(0.18, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.22);
      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + 0.22);
    } catch (_) {}
  }, []);

  const playShield = useCallback(() => {
    try {
      const ac = getAudioContext(ctxRef);
      [660, 880].forEach((freq, i) => {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.type = 'sine';
        const t = ac.currentTime + i * 0.04;
        osc.frequency.setValueAtTime(freq, t);
        osc.frequency.linearRampToValueAtTime(freq * 1.5, t + 0.25);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.start(t);
        osc.stop(t + 0.3);
      });
    } catch (_) {}
  }, []);

  return {
    playEat,
    playDie,
    playCaptureStart,
    playCaptureOwned,
    playShoot,
    playEnemyShoot,
    playShield,
  };
}

function idToFreq(id, min, max) {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) & 0x7fffffff;
  }
  return min + (h % (max - min));
}
