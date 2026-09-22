// client/src/render/rig_biped.js — the humanoid: old-school MMO proportions in flat-shaded low poly.
// ~7 heads tall at 1.8 m (size 1): tapered chest over a pelvis and belt, pauldrons, a neck, a head
// with jaw, nose, brow and hair cap, upper arms with elbows, forearms with bracers and hands,
// thighs with knees, shins with boots. Colour zones (skin, hair, cloth, leather, armour, trim)
// stand in for painted textures. Geometry is authored in part-local space with the pivot at the
// joint; assembly offsets live in BIPED so rig.js and anim.js share them.
import { box, taperBox, prism, cone, ball, merge, shade, WOOD } from './rig_parts.js';
import { mixHex } from './materials.js';

/** Joint layout at size 1, metres. torsoY is the hip height; everything hangs from there. */
export const BIPED = {
  height: 1.84,
  torsoY: 0.88, headY: 0.68,
  shoulderX: 0.27, shoulderY: 0.56, elbowY: -0.28, handY: -0.29, handZ: 0.03,
  hipX: 0.11, kneeY: -0.42,
};

/** Every part geometry for a palette + weapon kind. Keys are consumed by rig.js assembleBiped. */
export function buildBipedParts(p, weapon) {
  const leather = mixHex(0x3a2718, p.cloth, 0.2);
  const trousers = shade(p.cloth, 0.72);
  const armourDark = shade(p.armour, 0.78);
  const skinDark = shade(p.skin, 0.85);
  return {
    torso: merge([
      prism(0.19, 0.17, 0.20, 8, trousers, 0, 0.04, 0, 0, 0, 0, 1.15, 0.75),     // pelvis −0.06..0.14
      prism(0.205, 0.195, 0.06, 8, leather, 0, 0.17, 0, 0, 0, 0, 1.15, 0.78),    // belt 0.14..0.20
      box(0.07, 0.05, 0.03, p.trim, 0, 0.17, 0.16),                               // buckle
      prism(0.21, 0.16, 0.42, 8, p.cloth, 0, 0.41, 0, 0, 0, 0, 1.2, 0.7),         // chest 0.20..0.62
      prism(0.215, 0.185, 0.26, 8, p.armour, 0, 0.47, 0, 0, 0, 0, 1.22, 0.74),    // breastplate band
      box(0.03, 0.24, 0.03, armourDark, 0, 0.47, 0.165),                          // centre ridge
      box(0.12, 0.05, 0.02, armourDark, 0, 0.30, 0.16),                           // lower plate edge
      cone(0.105, 0.10, 6, p.armour, BIPED.shoulderX, 0.60, 0),                   // pauldrons
      cone(0.105, 0.10, 6, p.armour, -BIPED.shoulderX, 0.60, 0),
      prism(0.06, 0.068, 0.13, 6, skinDark, 0, 0.635, 0),                         // neck 0.57..0.70
    ]),
    head: merge([
      ball(0.125, 7, 5, p.skin, 0, 0.135, 0, 1.0, 1.1, 1.0),                      // skull 0..0.27
      taperBox(0.19, 0.10, 0.17, 1, 1, 0.66, 0.6, p.skin, 0, 0.065, 0.025),       // jaw, narrower at the chin
      taperBox(0.035, 0.05, 0.05, 0.8, 0.5, 1, 1, skinDark, 0, 0.135, 0.128),     // nose
      box(0.15, 0.022, 0.03, p.hair, 0, 0.18, 0.117),                              // brow
      ball(0.138, 7, 5, p.hair, 0, 0.135, -0.005, 1.0, 1.1, 1.0, 0, 1.2),         // hair cap (top 69°)
      taperBox(0.25, 0.17, 0.07, 1, 1, 0.82, 1, p.hair, 0, 0.14, -0.105),         // hair, back
      box(0.036, 0.03, 0.02, p.eyes, 0.046, 0.152, 0.118),
      box(0.036, 0.03, 0.02, p.eyes, -0.046, 0.152, 0.118),
    ]),
    upperArm: merge([
      prism(0.075, 0.06, 0.28, 7, p.cloth, 0, -0.14, 0),                          // shoulder at the origin
    ]),
    forearm: merge([
      prism(0.062, 0.055, 0.12, 7, p.cloth, 0, -0.06, 0),                         // sleeve, elbow at the origin
      prism(0.058, 0.048, 0.13, 7, leather, 0, -0.185, 0),                        // bracer
      taperBox(0.075, 0.09, 0.055, 1, 1, 0.85, 0.85, p.skin, 0, -0.29, 0.01),     // hand
    ]),
    thigh: merge([
      prism(0.105, 0.08, 0.42, 8, trousers, 0, -0.21, 0),                         // hip at the origin
    ]),
    shin: merge([
      prism(0.078, 0.06, 0.24, 7, trousers, 0, -0.12, 0),                         // knee at the origin
      prism(0.076, 0.066, 0.17, 7, leather, 0, -0.305, 0),                        // boot shaft
      taperBox(0.13, 0.10, 0.25, 1, 1, 0.95, 0.9, leather, 0, -0.41, 0.05),       // boot, sole at −0.46
    ]),
    weapon: weapon ? buildWeapon(weapon, p) : null,
  };
}

// ---------------------------------------------------------------- weapons (grip at origin, business end +y)

/** A dark leather grip wrap tinted toward the trim colour. */
function leatherWrap(trim) { return mixHex(0x3a2718, trim, 0.25); }

export function buildWeapon(kind, p) {
  const steel = p.weapon, trim = p.trim;
  switch (kind) {
    case 'sword': return merge([
      box(0.05, 0.16, 0.05, WOOD, 0, 0, 0),
      box(0.07, 0.07, 0.07, trim, 0, -0.1, 0),
      box(0.22, 0.04, 0.06, trim, 0, 0.1, 0),
      taperBox(0.08, 0.7, 0.03, 0.8, 1, 1, 1, steel, 0, 0.47, 0, 0, 0, 0, 0.03),
      taperBox(0.065, 0.1, 0.025, 0.2, 1, 1, 1, steel, 0, 0.87, 0, 0, 0, 0, 0.03),
    ]);
    case 'axe': return merge([
      box(0.05, 0.95, 0.05, WOOD, 0, 0.3, 0),
      box(0.07, 0.1, 0.07, trim, 0, 0.5, 0),
      box(0.04, 0.24, 0.26, steel, 0, 0.64, 0.12, 0, 0, 0, 0.03),
      box(0.04, 0.1, 0.1, steel, 0, 0.64, -0.06, 0, 0, 0, 0.03),
    ]);
    case 'mace': return merge([
      box(0.05, 0.78, 0.05, WOOD, 0, 0.25, 0),
      box(0.07, 0.1, 0.07, trim, 0, 0.02, 0),
      box(0.16, 0.16, 0.16, steel, 0, 0.66, 0, 0, 0, 0, 0.03),
      box(0.14, 0.14, 0.14, shade(steel, 0.75), 0, 0.66, 0, 0, Math.PI / 4, 0, 0.03),
    ]);
    case 'dagger': return merge([
      box(0.04, 0.12, 0.04, WOOD, 0, 0, 0),
      box(0.12, 0.03, 0.04, trim, 0, 0.07, 0),
      taperBox(0.05, 0.3, 0.02, 0.6, 1, 1, 1, steel, 0, 0.24, 0, 0, 0, 0, 0.03),
      taperBox(0.03, 0.06, 0.015, 0.2, 1, 1, 1, steel, 0, 0.42, 0, 0, 0, 0, 0.03),
    ]);
    case 'bow': {
      const stave = 0x8a6a42, string = 0xb8b4a0;   // pale ash and a light string so it reads against dark cloth
      return merge([
        box(0.045, 0.16, 0.055, leatherWrap(trim), 0, 0, 0),
        box(0.035, 0.42, 0.045, stave, 0, 0.2, -0.06, -0.3),
        box(0.035, 0.42, 0.045, stave, 0, -0.2, -0.06, 0.3),
        box(0.045, 0.05, 0.045, trim, 0, 0.42, -0.125),
        box(0.045, 0.05, 0.045, trim, 0, -0.42, -0.125),
        box(0.02, 0.8, 0.02, string, 0, 0, -0.125, 0, 0, 0, 0),
      ]);
    }
    case 'staff': return merge([
      box(0.05, 1.6, 0.05, WOOD, 0, 0.15, 0),
      box(0.12, 0.12, 0.12, trim, 0, 0.98, 0),
      box(0.08, 0.05, 0.08, trim, 0, 0.84, 0),
      box(0.06, 0.06, 0.06, steel, 0, -0.65, 0, 0, 0, 0, 0.03),
    ]);
    case 'wand': return merge([
      box(0.035, 0.4, 0.035, WOOD, 0, 0.15, 0),
      box(0.05, 0.08, 0.05, trim, 0, 0, 0),
      box(0.06, 0.06, 0.06, steel, 0, 0.37, 0, 0, Math.PI / 4, 0, 0.03),
    ]);
    case 'spear': return merge([
      box(0.045, 1.7, 0.045, WOOD, 0, 0.25, 0),
      box(0.07, 0.08, 0.07, trim, 0, 1.08, 0),
      taperBox(0.05, 0.28, 0.035, 0.2, 1, 1, 1, steel, 0, 1.24, 0, 0, 0, 0, 0.03),
      box(0.05, 0.05, 0.05, steel, 0, -0.6, 0, 0, 0, 0, 0.03),
    ]);
    default: return null;
  }
}
