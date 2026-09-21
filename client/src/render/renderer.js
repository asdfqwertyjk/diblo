// client/src/render/renderer.js — the WebGL renderer and the one scene.
// createRenderer(canvas) → { renderer, scene, resize(camera?), render(camera) }.
// Sized to the window; pixel ratio capped at 2; sRGB output for the flat vertex colours.
import * as THREE from 'three';

const MAX_PIXEL_RATIO = 2;
const CLEAR_COLOUR = 0x0e0d12; // page background until a zone view sets scene.background

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(CLEAR_COLOUR, 1);

  const scene = new THREE.Scene();
  let lastCamera = null;

  /** Resize to the window. If a camera is given (or one was rendered before), its aspect follows. */
  function resize(camera) {
    const w = Math.max(1, window.innerWidth | 0);
    const h = Math.max(1, window.innerHeight | 0);
    renderer.setSize(w, h, false); // CSS already makes the canvas full-window
    const cam = camera || lastCamera;
    if (cam && cam.isPerspectiveCamera) {
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    return w / h;
  }

  function render(camera) {
    if (camera !== lastCamera) { lastCamera = camera; resize(camera); }
    renderer.render(scene, camera);
  }

  function onWindowResize() { resize(); }
  window.addEventListener('resize', onWindowResize);

  function dispose() {
    window.removeEventListener('resize', onWindowResize);
    renderer.dispose();
  }

  resize();
  return { renderer, scene, resize, render, dispose };
}
