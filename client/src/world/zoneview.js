// client/src/world/zoneview.js — one zone on screen: terrain + props + the two lights,
// with the scene's sky and fog set from the biome. groundY is allocation-free.
import { Color, DirectionalLight, Fog, Group, HemisphereLight } from 'three';
import { groundHeight } from 'shared/sim/zonegen.js';
import { buildTerrain } from './terrain.js';
import { buildProps } from './props.js';
import { LIGHT_SCALE } from '../render/materials.js';

/** Distance of the directional light from the zone centre along biome.sun.dir. */
const SUN_DISTANCE = 60;

/**
 * @param {import('three').Scene} scene
 * @param {object} layout  from generateZone
 * @param {object} biome   recipe.biome
 * @param {object} kit     from buildKit()
 * @returns {{ group: Group, groundY: (x:number, z:number) => number, dispose: () => void }}
 */
export function createZoneView(scene, layout, biome, kit) {
  const N = layout.size;
  const cx = N / 2, cz = N / 2;

  const group = new Group();
  group.name = 'zone:' + layout.id;

  const terrain = buildTerrain(layout, biome);
  const props = buildProps(layout, kit);
  group.add(terrain);
  group.add(props);

  // Sun: sits SUN_DISTANCE metres from the zone centre along dir, shining at the centre,
  // so the light direction is exactly -dir regardless of where the zone sits.
  const sun = new DirectionalLight(biome.sun.color, biome.sun.intensity * LIGHT_SCALE);
  const d = biome.sun.dir;
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  sun.position.set(cx + (d[0] / len) * SUN_DISTANCE, (d[1] / len) * SUN_DISTANCE, cz + (d[2] / len) * SUN_DISTANCE);
  sun.target.position.set(cx, 0, cz);
  sun.name = 'sun';
  group.add(sun);
  group.add(sun.target); // the target needs a parent for its world matrix to update

  // No position for the hemisphere light: three derives its sky direction from the normalised
  // world position, so the constructor's default (0,1,0) is exactly "sky straight up".
  const hemi = new HemisphereLight(biome.hemi.sky, biome.hemi.ground, biome.hemi.intensity * LIGHT_SCALE);
  hemi.name = 'hemi';
  group.add(hemi);

  const fog = new Fog(biome.sky, biome.fog.near, biome.fog.far);
  scene.background = new Color(biome.sky);
  scene.fog = fog;
  scene.add(group);

  let disposed = false;
  return {
    group,
    groundY(x, z) { return groundHeight(layout, x, z); },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(group);
      terrain.userData.dispose();
      props.userData.dispose();
      sun.dispose();
      hemi.dispose();
      if (scene.fog === fog) scene.fog = null; // leave a newer zone's fog alone
    },
  };
}
