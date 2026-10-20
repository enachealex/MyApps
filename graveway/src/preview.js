/* Pictures of guns with their parts fitted, for the Armory. Each one is
   drawn once, side-on, on a small renderer kept just for this (making a new
   WebGL context per picture would run out of them), and cached as an image
   URL by gun and parts. */

import * as THREE from '../vendor/three.module.min.js';
import { makeGun } from './models.js';

const W = 480, H = 200;
let renderer = null, scene, cam;
const cache = new Map();

function setup() {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xd8e4ff, 0x30281e, 1.7));
  const key = new THREE.DirectionalLight(0xfff2e0, 2.4);
  key.position.set(-3, 4, 2);
  const rim = new THREE.DirectionalLight(0x9be15d, 1.2);
  rim.position.set(2, 1, -3);
  scene.add(key, rim);
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
}

/* An image URL of `model` with `fitted` parts (slot -> part id), muzzle to
   the right. Null if WebGL isn't available. */
export function gunPicture(model, fitted = {}) {
  const key = model + JSON.stringify(fitted);
  if (cache.has(key)) return cache.get(key);
  try {
    if (!renderer) setup();
  } catch { return null; }
  const gun = makeGun(model, fitted);
  gun.group.position.set(0, 0, 0);
  scene.add(gun.group);
  const box = new THREE.Box3().setFromObject(gun.group);
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  // From the left side and a little above, so +z (the muzzle) points right.
  const half = Math.max(size.z * 0.56, size.y * 0.56 * (W / H));
  cam.left = -half; cam.right = half;
  cam.top = half * (H / W); cam.bottom = -half * (H / W);
  cam.updateProjectionMatrix();
  cam.position.set(c.x - 6, c.y + 1.2, c.z - 0.6);
  cam.lookAt(c);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(gun.group);
  gun.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  cache.set(key, url);
  return url;
}
