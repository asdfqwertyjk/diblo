// client/src/render/rig_beasts.js — the wolf (quad) and the crow (bird) in the same low-poly idiom
// as the humanoid: tapered prisms, two-segment legs with joints, a real muzzle and beak.
// Quad parts: torso (with neck and hump), head (pivot at the neck end), upperLeg (pivot at the
// shoulder / hip), lowerLeg (pivot at the knee, with paw), tail (pivot at the rump), tail2.
// Bird parts: torso, head, wingL, wingR, leg.
import { box, taperBox, prism, cone, ball, wing, merge, shade } from './rig_parts.js';

export const QUAD = { height: 0.86, torsoY: 0.52, neckEnd: [0, 0.2, 0.46], legX: 0.12, frontZ: 0.24, backZ: -0.22, legY: -0.045, kneeY: -0.24, tailAt: [0, 0.07, -0.32], tail2Y: -0.24 };
export const BIRD = { height: 0.6, torsoY: 0.34, headAt: [0, 0.1, 0.16], wingX: 0.09, legY: 0.29 };

const HALF = Math.PI / 2;

export function buildQuadParts(p) {
  const dark = shade(p.body, 0.8);
  return {
    torso: merge([
      prism(0.19, 0.15, 0.62, 8, p.body, 0, 0, 0.02, HALF, 0, 0, 0.95, 1.15),       // ribcage → hindquarters
      prism(0.15, 0.12, 0.5, 8, p.belly, 0, -0.07, 0.04, HALF, 0, 0, 0.82, 0.9),     // belly, lighter
      box(0.25, 0.12, 0.26, p.body, 0, 0.17, 0.2),                                   // shoulder hump
      box(0.14, 0.05, 0.5, p.trim, 0, 0.2, -0.04),                                   // dark ridge along the back
      prism(0.1, 0.11, 0.24, 7, p.body, 0, 0.15, 0.37, HALF - 0.6, 0, 0, 1, 1),       // neck, forward and up
    ]),
    head: merge([
      ball(0.11, 7, 5, p.body, 0, 0.04, 0.06, 1.0, 0.95, 1.15),                      // skull
      prism(0.055, 0.075, 0.2, 6, p.belly, 0, 0.0, 0.2, HALF, 0, 0, 1, 0.9),          // muzzle, narrower at the nose
      box(0.05, 0.04, 0.04, dark, 0, 0.02, 0.305),                                   // nose
      taperBox(0.09, 0.04, 0.16, 1, 1, 0.8, 0.9, p.belly, 0, -0.05, 0.19),            // jaw
      cone(0.035, 0.09, 4, p.body, 0.07, 0.14, 0.0, -0.25, 0, 0),                     // ears
      cone(0.035, 0.09, 4, p.body, -0.07, 0.14, 0.0, -0.25, 0, 0),
      box(0.03, 0.03, 0.02, p.eyes, 0.055, 0.075, 0.15),
      box(0.03, 0.03, 0.02, p.eyes, -0.055, 0.075, 0.15),
    ]),
    upperLeg: merge([
      prism(0.07, 0.055, 0.24, 7, p.body, 0, -0.12, 0),                              // joint at the origin
    ]),
    lowerLeg: merge([
      prism(0.05, 0.04, 0.22, 6, dark, 0, -0.11, 0),                                  // knee at the origin
      taperBox(0.09, 0.06, 0.12, 1, 1, 1, 1, p.trim, 0, -0.225, 0.03),                // paw, bottom at −0.255
    ]),
    tail: merge([
      prism(0.045, 0.035, 0.24, 5, p.body, 0, 0, -0.12, -HALF, 0, 0),                // along −z from the rump
    ]),
    tail2: merge([
      prism(0.035, 0.02, 0.18, 5, p.body, 0, 0, -0.09, -HALF, 0, 0),
      taperBox(0.07, 0.07, 0.1, 1, 1, 0.6, 0.6, p.trim, 0, 0, -0.2, HALF, 0, 0),       // tuft
    ]),
  };
}

export function buildBirdParts(p) {
  return {
    torso: merge([
      prism(0.10, 0.06, 0.34, 7, p.body, 0, 0, 0, HALF, 0, 0, 1.0, 0.85),             // chest → tail
      prism(0.078, 0.05, 0.26, 6, p.belly, 0, -0.03, 0.02, HALF, 0, 0, 0.9, 0.75),     // belly
      taperBox(0.14, 0.02, 0.18, 1, 1, 1, 1, p.trim, 0, 0.015, -0.26, 0.3, 0, 0),      // tail feathers, tilted up
    ]),
    head: merge([
      ball(0.065, 6, 4, p.body, 0, 0.05, 0.03, 1, 1, 1.08),
      cone(0.028, 0.13, 5, p.trim, 0, 0.04, 0.09, HALF, 0, 0),                         // beak along +z
      box(0.03, 0.03, 0.02, p.eyes, 0.05, 0.075, 0.075),
      box(0.03, 0.03, 0.02, p.eyes, -0.05, 0.075, 0.075),
    ]),
    wingL: wing(0.36, 0.025, 0.22, 0.12, p.body, p.trim, 1),
    wingR: wing(0.36, 0.025, 0.22, 0.12, p.body, p.trim, -1),
    leg: merge([
      prism(0.014, 0.012, 0.25, 4, p.trim, 0, -0.125, 0),
      box(0.05, 0.015, 0.09, p.trim, 0, -0.283, 0.03),
    ]),
  };
}
