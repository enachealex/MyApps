/* Movement input. On a phone you press anywhere on the play area and drag:
   a joystick appears under your thumb. On a computer, WASD or the arrow keys
   do the same. Aiming and firing are automatic.

   Any number of fingers can be down. The first one on the play area steers;
   if it lifts while another is still down, that one takes over the stick
   where it is, so swapping thumbs never stops you. */

const RADIUS = 56;      // px from the joystick centre to full speed
const DEADZONE = 0.12;

export class Input {
  constructor(surface, base, knob) {
    this.surface = surface;
    this.base = base;
    this.knob = knob;
    this.pointer = null;          // the steering finger: { id, ox, oy }
    this.fingers = new Map();     // every finger down on the play area: id -> { x, y }
    this.stick = { x: 0, y: 0 };
    this.keys = new Set();
    this.enabled = false;

    surface.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.moveTo(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    window.addEventListener('blur', () => { this.release(); this.keys.clear(); });

    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.target.closest?.('textarea, input')) return;
      this.keys.add(e.code);
      if (this.onKey) this.onKey(e.code, e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  down(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this.fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!this.pointer) this.grab(e.pointerId, e.clientX, e.clientY);
  }

  grab(id, x, y) {
    this.pointer = { id, ox: x, oy: y };
    this.stick.x = this.stick.y = 0;
    this.base.style.transform = `translate(${x}px, ${y}px)`;
    this.knob.style.transform = 'translate(0px, 0px)';
    this.base.classList.add('on');
  }

  moveTo(e) {
    const f = this.fingers.get(e.pointerId);
    if (f) { f.x = e.clientX; f.y = e.clientY; }
    const p = this.pointer;
    if (!p || e.pointerId !== p.id) return;
    let dx = e.clientX - p.ox;
    let dy = e.clientY - p.oy;
    const len = Math.hypot(dx, dy);
    // Past the rim the base follows the thumb, so changing direction never
    // means dragging all the way back across the circle.
    if (len > RADIUS * 1.35) {
      const k = (len - RADIUS * 1.35) / len;
      p.ox += dx * k;
      p.oy += dy * k;
      dx = e.clientX - p.ox;
      dy = e.clientY - p.oy;
      this.base.style.transform = `translate(${p.ox}px, ${p.oy}px)`;
    }
    const l = Math.hypot(dx, dy);
    const clamped = Math.min(l, RADIUS);
    const nx = l ? dx / l : 0;
    const ny = l ? dy / l : 0;
    this.knob.style.transform = `translate(${nx * clamped}px, ${ny * clamped}px)`;
    const mag = clamped / RADIUS;
    const m = mag < DEADZONE ? 0 : (mag - DEADZONE) / (1 - DEADZONE);
    this.stick.x = nx * m;
    this.stick.y = ny * m;
  }

  up(e) {
    this.fingers.delete(e.pointerId);
    if (!this.pointer || e.pointerId !== this.pointer.id) return;
    this.pointer = null;
    this.stick.x = this.stick.y = 0;
    this.base.classList.remove('on');
    // Hand the stick to the finger that went down most recently.
    let next = null;
    for (const [id, f] of this.fingers) next = { id, f };
    if (next) this.grab(next.id, next.f.x, next.f.y);
  }

  release() {
    this.pointer = null;
    this.fingers.clear();
    this.stick.x = this.stick.y = 0;
    this.base.classList.remove('on');
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.release();
  }

  /* World-space direction: x is across the road, z is toward the camera
     (so pushing up on the stick walks you up the road, toward -z). */
  get move() {
    const k = this.keys;
    let x = this.stick.x;
    let z = this.stick.y;
    const kx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const kz = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    if (kx || kz) {
      const l = Math.hypot(kx, kz);
      x = kx / l;
      z = kz / l;
    }
    return { x, z };
  }
}
