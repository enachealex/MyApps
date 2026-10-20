/* Fog of war: the survivor can't see through things taller than a person.
   Walls, fuel tankers, condemned buildings and building fronts block the
   view; cars, slabs, barrels, barricades and lamp posts don't.

   Two halves:
     canSee()      is a zombie in view? Game hides the ones that aren't and
                   won't aim at them.
     SightShadows  darkens the ground behind each blocker, as if the
                   flashlight cast shadows, so you can tell where the blind
                   spots are. One draw call: every shadow is a quad in one
                   buffer, and the stencil buffer stops overlapping ones
                   doubling up.                                            */

import * as THREE from '../vendor/three.module.min.js';
import { rayProps } from './world.js';

export const SIGHT_HEIGHT = 2;        // props at least this tall block the view (a car is 1.6)
const REACH = 36;                     // blockers further than this cast no shadow
const FAR = 44;                       // how far a shadow reaches
const MAX_QUADS = 48;
const Y = 0.17;                       // just above the kerb, so sidewalks shade too

export const blocksSight = (c) => !c.destroyed && !c.airborne && c.height >= SIGHT_HEIGHT && Math.min(c.hw, c.hd) > 0.2;

/* Is (tx, tz) in view from (x, z)? `pad` is how much of the target has to
   be behind cover before it counts as hidden. */
export function canSee(world, x, z, tx, tz, pad = 0.3) {
  const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz);
  if (d < 0.5) return true;
  const ux = dx / d, uz = dz / d, len = d - pad;
  if (rayProps(world.props, x, z, ux, uz, len, blocksSight).t < len) return false;
  return world.facadeT(x, z, ux, uz, len) >= len;
}

export class SightShadows {
  constructor(scene) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX_QUADS * 6 * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0x020406, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -2;
    scene.add(this.mesh);
  }

  /* Rebuilds the shadows for the survivor at (px, pz). */
  update(px, pz, props) {
    const P = this.pos;
    let n = 0;
    const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
    for (const c of props) {
      if (n >= MAX_QUADS) break;
      if (!blocksSight(c)) continue;
      const cx = c.x - px, cz = c.z - pz, cd = Math.hypot(cx, cz);
      if (cd > REACH + c.r || cd < c.r + 0.3) continue;      // too far, or you're right against it
      // The two corners that make its outline from where you stand.
      let lo = Infinity, hi = -Infinity, A = null, B = null;
      for (const [sx, sz] of corners) {
        const lx = sx * c.hw, lz = sz * c.hd;
        const wx = c.x + lx * c.cos + lz * c.sin, wz = c.z - lx * c.sin + lz * c.cos;
        const vx = wx - px, vz = wz - pz;
        const a = Math.atan2(cx * vz - cz * vx, cx * vx + cz * vz);
        if (a < lo) { lo = a; A = [wx, wz]; }
        if (a > hi) { hi = a; B = [wx, wz]; }
      }
      const far = (q) => {
        const vx = q[0] - px, vz = q[1] - pz, l = Math.hypot(vx, vz) || 1;
        return [q[0] + (vx / l) * FAR, q[1] + (vz / l) * FAR];
      };
      const A2 = far(A), B2 = far(B);
      let i = n * 18;
      for (const q of [A, B, B2, A, B2, A2]) { P[i++] = q[0]; P[i++] = Y; P[i++] = q[1]; }
      n++;
    }
    const g = this.mesh.geometry;
    g.setDrawRange(0, n * 6);
    g.attributes.position.needsUpdate = true;
  }

  clear() { this.mesh.geometry.setDrawRange(0, 0); }
}
