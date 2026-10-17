/* Every sound is synthesised with Web Audio, so the game ships no audio
   files. Browsers only allow sound after a tap, so unlockAudio() is called
   from the first pointer press. */

let ctx = null;
let master = null;
let noiseBuf = null;
let enabled = true;
const last = {};

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 6;
    master = ctx.createGain();
    master.gain.value = enabled ? 0.55 : 0;
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function setSoundEnabled(on) {
  enabled = on;
  if (master) master.gain.value = on ? 0.55 : 0;
}

/* Drops a sound if the same one played less than `gap` seconds ago, so a
   minigun or a pile of coins doesn't stack into a wall of noise. */
function throttle(name, gap) {
  if (!ctx || !enabled) return false;
  const t = ctx.currentTime;
  if (last[name] && t - last[name] < gap) return false;
  last[name] = t;
  return true;
}

function out(pan) {
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(master);
    return p;
  }
  return master;
}

function noise({ dur, freq, q = 1, type = 'bandpass', vol = 0.5, attack = 0.002, pan = 0, sweep = 0 }) {
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out(pan));
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

function tone({ freq, dur, type = 'sine', vol = 0.3, to = 0, delay = 0, attack = 0.004, pan = 0 }) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out(pan));
  o.start(t);
  o.stop(t + dur + 0.02);
}

const SHOTS = {
  pistol:  { freq: 1700, dur: 0.13, thump: 140, vol: 0.55 },
  smg:     { freq: 2300, dur: 0.07, thump: 170, vol: 0.4 },
  shotgun: { freq: 900,  dur: 0.32, thump: 75,  vol: 0.8 },
  rifle:   { freq: 1400, dur: 0.16, thump: 110, vol: 0.55 },
  minigun: { freq: 2600, dur: 0.06, thump: 190, vol: 0.32 },
};

export const sfx = {
  shot(id) {
    const s = SHOTS[id] || SHOTS.pistol;
    if (!throttle('shot', 0.035)) return;
    noise({ dur: s.dur, freq: s.freq, q: 0.7, vol: s.vol, sweep: 0.35 });
    tone({ freq: s.thump, to: 40, dur: s.dur * 0.9, type: 'triangle', vol: s.vol * 0.7 });
  },
  hit(pan) {
    if (!throttle('hit', 0.04)) return;
    noise({ dur: 0.08, freq: 500, q: 1.2, type: 'lowpass', vol: 0.3, pan });
  },
  die(pan) {
    if (!throttle('die', 0.06)) return;
    tone({ freq: 160, to: 55, dur: 0.35, type: 'sawtooth', vol: 0.12, pan });
    noise({ dur: 0.25, freq: 300, type: 'lowpass', vol: 0.25, pan });
  },
  groan(pan, big) {
    if (!throttle('groan', 0.7)) return;
    const f = (big ? 55 : 85) + Math.random() * 30;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * 0.7, t + 0.9);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7 + Math.random() * 4;
    const lfoG = ctx.createGain();
    lfoG.gain.value = f * 0.06;
    lfo.connect(lfoG).connect(o.frequency);
    const fl = ctx.createBiquadFilter();
    fl.type = 'bandpass';
    fl.frequency.value = big ? 380 : 650;
    fl.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(big ? 0.22 : 0.12, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    o.connect(fl).connect(g).connect(out(pan));
    o.start(t); lfo.start(t);
    o.stop(t + 1.05); lfo.stop(t + 1.05);
  },
  coin() {
    if (!throttle('coin', 0.05)) return;
    tone({ freq: 1320, dur: 0.08, type: 'square', vol: 0.06 });
    tone({ freq: 1760, dur: 0.12, type: 'square', vol: 0.06, delay: 0.05 });
  },
  pickup() {
    if (!throttle('pickup', 0.1)) return;
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.14, type: 'triangle', vol: 0.18, delay: i * 0.06 }));
  },
  hurt() {
    if (!throttle('hurt', 0.12)) return;
    noise({ dur: 0.2, freq: 220, type: 'lowpass', vol: 0.6 });
    tone({ freq: 120, to: 60, dur: 0.2, type: 'square', vol: 0.12 });
  },
  reload() {
    if (!throttle('reload', 0.2)) return;
    noise({ dur: 0.04, freq: 3000, q: 4, vol: 0.25 });
    setTimeout(() => ctx && noise({ dur: 0.05, freq: 2200, q: 4, vol: 0.3 }), 160);
  },
  swap() {
    if (!throttle('swap', 0.1)) return;
    noise({ dur: 0.06, freq: 2600, q: 3, vol: 0.25 });
  },
  click() {
    if (!throttle('click', 0.05)) return;
    tone({ freq: 880, dur: 0.05, type: 'triangle', vol: 0.12 });
  },
  buy() {
    if (!throttle('buy', 0.1)) return;
    tone({ freq: 660, dur: 0.1, type: 'square', vol: 0.08 });
    tone({ freq: 990, dur: 0.18, type: 'square', vol: 0.08, delay: 0.08 });
  },
  denied() {
    if (!throttle('denied', 0.15)) return;
    tone({ freq: 180, dur: 0.18, type: 'square', vol: 0.1 });
  },
  win() {
    if (!throttle('win', 1)) return;
    [392, 523, 659, 784].forEach((f, i) => tone({ freq: f, dur: 0.5, type: 'triangle', vol: 0.18, delay: i * 0.12 }));
  },
  lose() {
    if (!throttle('lose', 1)) return;
    [330, 262, 196, 131].forEach((f, i) => tone({ freq: f, dur: 0.5, type: 'sawtooth', vol: 0.08, delay: i * 0.18 }));
  },
  slam() {
    if (!throttle('slam', 0.3)) return;
    noise({ dur: 0.45, freq: 160, type: 'lowpass', vol: 0.9 });
    tone({ freq: 70, to: 30, dur: 0.4, type: 'sine', vol: 0.5 });
  },
};

export function vibrate(ms, on) {
  if (on && navigator.vibrate) {
    try { navigator.vibrate(ms); } catch { /* not allowed here */ }
  }
}
