// client/src/render/camera.js — fixed-angle isometric-ish follow camera.
// createIsoCamera(aspect) → { camera, follow(x,y,z), setZoom(step), zoomStep,
//   screenToGround(ndcX, ndcY, groundY) → [x,z] | null, update(dt) }.
// Yaw 45°, pitch 55° from horizontal, two zoom steps (18 m, 24 m), no rotation.
// Every Vector3 / Raycaster / Plane is created once; nothing allocates per frame.
import * as THREE from 'three';

const FOV = 40;
const NEAR = 0.5;
const FAR = 220;
const YAW = Math.PI / 4;                 // 45°: the camera sits south-east of its target
const PITCH = (55 * Math.PI) / 180;      // from horizontal
const ZOOM_STEPS = [18, 24];             // metres from the target
const FOLLOW_RATE = 12;                  // per second; frame-rate independent via exp

export function createIsoCamera(aspect) {
  const camera = new THREE.PerspectiveCamera(FOV, aspect || 1, NEAR, FAR);

  const target = new THREE.Vector3();    // smoothed point the camera looks at
  const goal = new THREE.Vector3();      // where follow() asked us to look
  const offset = new THREE.Vector3();    // camera position relative to the target
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const out = [0, 0];                    // reused: callers copy what they need
  let zoomStep = 0;
  let snapped = false;

  /** Offset is fixed per zoom step, so orientation is computed here, once, not per frame. */
  function computeOffset() {
    const d = ZOOM_STEPS[zoomStep];
    const flat = d * Math.cos(PITCH);
    offset.set(flat * Math.sin(YAW), d * Math.sin(PITCH), flat * Math.cos(YAW));
    camera.position.copy(offset);
    camera.lookAt(0, 0, 0);
    camera.position.copy(target).add(offset);
    camera.updateMatrixWorld();
  }

  function setZoom(step) {
    const s = step < 0 ? 0 : step > ZOOM_STEPS.length - 1 ? ZOOM_STEPS.length - 1 : step | 0;
    if (s === zoomStep) return zoomStep;
    zoomStep = s;
    computeOffset();
    return zoomStep;
  }

  function follow(x, y, z) {
    goal.set(x, y, z);
    if (!snapped) { target.copy(goal); snapped = true; }
  }

  function update(dt) {
    // exponential approach: identical feel at 30 or 144 fps
    const k = 1 - Math.exp(-FOLLOW_RATE * (dt > 0 ? dt : 0));
    target.lerp(goal, k);
    camera.position.copy(target).add(offset);
    camera.updateMatrixWorld();
  }

  /** Intersect the mouse ray with the plane y = groundY. Returns a reused [x, z] or null. */
  function screenToGround(ndcX, ndcY, groundY) {
    plane.constant = -(groundY || 0);
    ndc.set(ndcX, ndcY);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    out[0] = hit.x; out[1] = hit.z;
    return out;
  }

  computeOffset();

  return {
    camera, follow, setZoom, screenToGround, update,
    get zoomStep() { return zoomStep; },
    get target() { return target; },
    ZOOM_STEPS,
  };
}
