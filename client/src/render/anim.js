// client/src/render/anim.js — procedural poses for the rigs built in rig.js.
// animateRig(rigObj, anim, time, moveSpeed) sets part rotations/positions directly every call:
// no Vector3, no closures, no per-call objects. Per-rig state (last anim, its start time, the run
// phase accumulator, the idle/run blend weight, a seed offset) lives in rigObj.anim, written once
// by createRig. The rig faces +z; a positive rotation.x on a limb pivoted at its top swings the
// limb backward (−z), a negative one forward (+z). A positive torso rotation.x leans forward.
// Elbows (forearmL/R) and knees (shinL/R) bend the same way: a negative forearm x is a bent
// elbow (hand forward), a positive shin x is a bent knee (foot back).

const TAU = Math.PI * 2;
const CHOP = 0, THRUST = 1, SHOOT = 2;

// Weapon geometry has its grip at the origin and its business end along +y (see rig_biped.js),
// so these are rotation.x values local to the right forearm: rest (arm hanging), attack wind-up,
// attack end, and the cast pose. They pair with the arm angles in ARM_WIND / ARM_END per style.
const BLADE = { rest: 2.8, wind: 2.1, end: 2.75, cast: 2.45, style: CHOP };
export const WEAPON_POSE = {
  sword: BLADE, axe: BLADE, mace: BLADE, dagger: BLADE, wand: BLADE,
  staff: { rest: 0.15, wind: 1.96, end: 2.69, cast: 2.45, style: CHOP },
  spear: { rest: 0.35, wind: 0.97, end: 2.77, cast: 2.45, style: THRUST },
  bow:   { rest: 0.15, wind: 1.5,  end: 1.5,  cast: 2.0,  style: SHOOT },
};
const FIST = { rest: 0, wind: 0, end: 0, cast: 0, style: CHOP };
const ARM_REST = -0.2;
const ARM_WIND = [-2.6, 0.6, -1.5];   // by style: overhead / pulled back / raised level
const ARM_END = [-0.6, -1.2, -1.5];
const ELBOW_REST = -0.25;             // slight bend when hanging
const ELBOW_WIND = [-1.5, -0.9, -0.4];
const ELBOW_END = [-0.15, -0.1, -0.4];

// run-cycle frequency per m/s of move speed (cycles per second per metre per second)
const STRIDE = { biped: 0.42, quad: 0.55, bird: 1.2 };
const ATTACK_PERIOD = { biped: 0.6, quad: 0.55, bird: 0.5 };
const HIT_TIME = 0.35, DIE_TIME = 0.7;

function lerp(a, b, k) { return a + (b - a) * k; }
function ease(k) { return k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k); }

/** Every animated part back to its rest transform (stored in userData by rig.js). */
function restPose(r) {
  r.root.position.set(0, 0, 0);
  r.root.rotation.set(0, 0, 0);
  const list = r.animated;
  for (let i = 0; i < list.length; i++) {
    const m = list[i], u = m.userData;
    m.rotation.set(u.rx, u.ry, u.rz);
    m.position.y = u.y0;
    m.position.z = u.z0;
  }
}

/**
 * @param {object} r        object returned by createRig
 * @param {string} anim     'idle' | 'run' | 'attack' | 'hit' | 'die' | 'cast'
 * @param {number} time     seconds
 * @param {number} moveSpeed metres per second while running (drives stride rate)
 */
export function animateRig(r, anim, time, moveSpeed) {
  const a = r.anim;
  let dt = time - a.last;
  if (!(dt >= 0 && dt <= 0.1)) dt = 0.1;
  a.last = time;
  if (anim !== a.name) { a.name = anim; a.t0 = time; }
  const phase = time - a.t0;

  const wantRun = anim === 'run' ? 1 : 0;
  a.run += (wantRun - a.run) * Math.min(1, dt * 10);
  if (a.run < 0.001) a.run = 0;
  if (wantRun) {
    const speed = Math.min(12, Math.max(1, moveSpeed > 0 ? moveSpeed : 5));
    a.phase += dt * TAU * speed * (STRIDE[r.rigKind || r.kind] || 0.42);
    if (a.phase > 6283.18) a.phase -= 6283.18;
  }

  restPose(r);
  const kind = r.rigKind || r.kind;   // rigKind survives callers that reuse `kind` for their own tag
  if (kind === 'quad') poseQuad(r, anim, time, phase, a);
  else if (kind === 'bird') poseBird(r, anim, time, phase, a);
  else poseBiped(r, anim, time, phase, a);
}

// ---------------------------------------------------------------- biped

function poseBiped(r, anim, t, ph, a) {
  const P = r.parts, root = r.root;
  const torso = P.torso, head = P.head, armL = P.armL, armR = P.armR, legL = P.legL, legR = P.legR, W = P.weapon;
  const fl = P.forearmL, fr = P.forearmR, sl = P.shinL, sr = P.shinR;
  const pose = (W && WEAPON_POSE[r.weapon]) || FIST;
  const s = a.seed;

  if (anim === 'die') {
    const k = Math.min(1, ph / DIE_TIME), e = k * k, kn = ease(Math.min(1, ph / 0.3));
    root.rotation.x = -1.52 * e;
    root.rotation.y = 0.3 * Math.sin(s) * e;
    root.position.y = 0.17 * e + 0.12 * kn * (1 - e);   // knees give first, then the fall
    torso.rotation.x = 0.35 * kn * (1 - e) + 0.1 * e;
    head.rotation.x = 0.3 * e;
    armL.rotation.x = -0.15 * e; armR.rotation.x = -0.2 * e;
    armL.rotation.z = 0.12 + 0.9 * e; armR.rotation.z = -0.12 - 0.9 * e;
    fl.rotation.x = -0.3 * (1 - e); fr.rotation.x = -0.3 * (1 - e);
    legL.rotation.x = -0.6 * kn * (1 - e) - 0.15 * e; legR.rotation.x = -0.5 * kn * (1 - e) + 0.1 * e;
    sl.rotation.x = 1.2 * kn * (1 - e) + 0.06; sr.rotation.x = 1.1 * kn * (1 - e) + 0.06;
    legL.rotation.z = 0.15 * e; legR.rotation.z = -0.15 * e;
    if (W) W.rotation.x = lerp(pose.rest, Math.PI, e);
    return;
  }

  if (anim === 'attack') {
    const p = ph % ATTACK_PERIOD.biped, st = pose.style;
    let k, ax, ex, wx, tx, ty, rz, lx;
    if (p < 0.12) {
      k = ease(p / 0.12);
      ax = lerp(ARM_REST, ARM_WIND[st], k); ex = lerp(ELBOW_REST, ELBOW_WIND[st], k); wx = lerp(pose.rest, pose.wind, k);
      tx = lerp(0, -0.15, k); ty = lerp(0, -0.35, k); rz = 0; lx = lerp(-0.5, -1.25, k);
    } else if (p < 0.22) {
      k = ease((p - 0.12) / 0.1);
      ax = lerp(ARM_WIND[st], ARM_END[st], k); ex = lerp(ELBOW_WIND[st], ELBOW_END[st], k); wx = lerp(pose.wind, pose.end, k);
      tx = lerp(-0.15, 0.3, k); ty = lerp(-0.35, 0.3, k); rz = lerp(0, 0.15, k); lx = lerp(-1.25, -0.7, k);
    } else {
      k = ease((p - 0.22) / (ATTACK_PERIOD.biped - 0.22));
      ax = lerp(ARM_END[st], ARM_REST, k); ex = lerp(ELBOW_END[st], ELBOW_REST, k); wx = lerp(pose.end, pose.rest, k);
      tx = lerp(0.3, 0, k); ty = lerp(0.3, 0, k); rz = lerp(0.15, 0, k); lx = lerp(-0.7, -0.5, k);
    }
    armR.rotation.x = ax; armR.rotation.z = -0.1;
    fr.rotation.x = ex;
    if (W) W.rotation.x = wx;
    // a shooter draws the string with the left hand; everyone else keeps a guard up
    armL.rotation.x = st === SHOOT ? lx : -0.5;
    armL.rotation.z = st === SHOOT ? 0.05 : 0.25;
    fl.rotation.x = st === SHOOT ? -0.6 : -0.95;
    torso.rotation.x = tx; torso.rotation.y = ty;
    root.position.z = rz;
    head.rotation.x = 0.1;
    legL.rotation.x = -0.35; legR.rotation.x = 0.3;
    sl.rotation.x = 0.35; sr.rotation.x = 0.12;
    return;
  }

  if (anim === 'cast') {
    const k = ease(ph / 0.2), pulse = Math.sin(t * 7) * 0.06;
    armL.rotation.x = lerp(0.05, -1.7 + pulse, k); armR.rotation.x = lerp(ARM_REST, -1.7 - pulse, k);
    armL.rotation.z = lerp(0.1, 0.35, k); armR.rotation.z = lerp(-0.1, -0.35, k);
    fl.rotation.x = lerp(ELBOW_REST, -1.2, k); fr.rotation.x = lerp(ELBOW_REST, -1.2, k);
    torso.rotation.x = -0.12 * k;
    head.rotation.x = -0.3 * k;
    legL.rotation.x = -0.15; legR.rotation.x = 0.15;
    sl.rotation.x = 0.12; sr.rotation.x = 0.12;
    if (W) W.rotation.x = lerp(pose.rest, pose.cast, k);
    return;
  }

  if (anim === 'hit' && ph < HIT_TIME) {
    const f = Math.sin(ph / HIT_TIME * Math.PI);
    torso.rotation.x = -0.4 * f;
    head.rotation.x = -0.35 * f;
    root.position.z = -0.18 * f;
    armL.rotation.x = 0.6 * f; armR.rotation.x = 0.6 * f;
    armL.rotation.z = 0.1 + 0.5 * f; armR.rotation.z = -0.1 - 0.5 * f;
    fl.rotation.x = ELBOW_REST - 0.7 * f; fr.rotation.x = ELBOW_REST - 0.7 * f;
    legL.rotation.x = 0.2 * f; legR.rotation.x = -0.25 * f;
    sl.rotation.x = 0.3 * f; sr.rotation.x = 0.35 * f;
    return;
  }

  // idle (breathing, weight on one leg, a look around) blended with run (stride, knees, elbows,
  // lean, bounce) by a.run
  const w = a.run, iw = 1 - w, c = a.phase;
  const br = Math.sin(t * 2.2 + s);
  const sw = Math.sin(c) * 0.85 * w;
  const cs = Math.cos(c);
  torso.position.y += br * 0.012 * iw;
  torso.rotation.x = (0.03 + br * 0.015) * iw + 0.18 * w;
  torso.rotation.z = (0.04 + Math.sin(t * 1.3 + s) * 0.02) * iw + Math.sin(c) * 0.05 * w;
  head.rotation.y = Math.sin(t * 0.7 + s) * 0.15 * iw;
  head.rotation.x = -0.12 * w;
  legL.rotation.x = 0.04 * iw + sw; legR.rotation.x = -0.04 * iw - sw;
  legL.rotation.z = 0.05 * iw; legR.rotation.z = -0.08 * iw;      // weight on the right leg
  // knees bend on the swing-through (the leg moving forward), stay near straight while planted
  sl.rotation.x = 0.06 * iw + Math.max(0, -cs) * 1.0 * w;
  sr.rotation.x = 0.2 * iw + Math.max(0, cs) * 1.0 * w;
  armL.rotation.x = (0.05 + br * 0.03) * iw - sw * 0.7;
  armR.rotation.x = (ARM_REST + br * 0.03) * iw + sw * 0.7;
  armL.rotation.z = 0.1; armR.rotation.z = -0.1;
  fl.rotation.x = ELBOW_REST * iw - 0.8 * w;
  fr.rotation.x = ELBOW_REST * iw - 0.8 * w;
  root.position.y = (0.5 - 0.5 * Math.cos(c * 2)) * 0.05 * w;
}

// ---------------------------------------------------------------- quad (front legs = armL/armR)

function poseQuad(r, anim, t, ph, a) {
  const P = r.parts, root = r.root;
  const body = P.torso, head = P.head, fl = P.armL, fr = P.armR, bl = P.legL, brr = P.legR, tail = P.tail, tail2 = P.tail2;
  const fl2 = P.forearmL, fr2 = P.forearmR, bl2 = P.shinL, br2 = P.shinR;
  const s = a.seed;

  if (anim === 'die') {
    const k = Math.min(1, ph / DIE_TIME), e = k * k;
    root.rotation.z = 1.45 * e;
    root.rotation.y = 0.2 * Math.sin(s) * e;
    root.position.y = 0.16 * e;
    head.rotation.x = 0.35 * e; head.rotation.y = 0.3 * e;
    tail.rotation.x = 0.5 - 0.6 * e;
    fl.rotation.x = -0.35 * e; fr.rotation.x = -0.15 * e;
    bl.rotation.x = 0.3 * e; brr.rotation.x = 0.15 * e;
    fl2.rotation.x = 0.4 * e; fr2.rotation.x = 0.3 * e; bl2.rotation.x = -0.3 * e; br2.rotation.x = -0.2 * e;
    return;
  }

  if (anim === 'attack') {
    const p = ph % ATTACK_PERIOD.quad;
    let k, bx, hx, rz, f1, f2, b1;
    if (p < 0.15) {
      k = ease(p / 0.15);
      bx = -0.18 * k; hx = -0.45 * k; rz = -0.1 * k; f1 = -0.6 * k; f2 = -0.5 * k; b1 = 0.3 * k;
    } else if (p < 0.27) {
      k = ease((p - 0.15) / 0.12);
      bx = lerp(-0.18, 0.22, k); hx = lerp(-0.45, 0.35, k); rz = lerp(-0.1, 0.3, k);
      f1 = lerp(-0.6, -1.0, k); f2 = lerp(-0.5, -0.9, k); b1 = lerp(0.3, 0.6, k);
    } else {
      k = ease((p - 0.27) / (ATTACK_PERIOD.quad - 0.27));
      bx = lerp(0.22, 0, k); hx = lerp(0.35, 0, k); rz = lerp(0.3, 0, k);
      f1 = lerp(-1.0, 0, k); f2 = lerp(-0.9, 0, k); b1 = lerp(0.6, 0, k);
    }
    body.rotation.x = bx; head.rotation.x = hx; root.position.z = rz;
    fl.rotation.x = f1; fr.rotation.x = f2; bl.rotation.x = b1; brr.rotation.x = b1;
    fl2.rotation.x = 0.1 - f1 * 0.5; fr2.rotation.x = 0.1 - f2 * 0.5;
    bl2.rotation.x = -0.1 - b1 * 0.6; br2.rotation.x = -0.1 - b1 * 0.6;
    tail.rotation.x = 0.2;
    return;
  }

  if (anim === 'cast') {
    // a howl: head up, front lifted, tail high, a tremble
    const k = ease(ph / 0.25);
    head.rotation.x = -0.75 * k + Math.sin(t * 10) * 0.03 * k;
    body.rotation.x = -0.22 * k;
    fl.rotation.x = -0.3 * k; fr.rotation.x = -0.3 * k;
    bl.rotation.x = 0.2 * k; brr.rotation.x = 0.2 * k;
    tail.rotation.x = lerp(0.5, 0.9, k);
    tail2.rotation.x = 0.25 + 0.2 * k;
    return;
  }

  if (anim === 'hit' && ph < HIT_TIME) {
    const f = Math.sin(ph / HIT_TIME * Math.PI);
    root.position.z = -0.16 * f;
    body.rotation.x = -0.28 * f;
    head.rotation.x = -0.45 * f;
    tail.rotation.x = 0.5 - 0.8 * f;
    fl.rotation.x = -0.4 * f; fr.rotation.x = -0.4 * f;
    fl2.rotation.x = 0.1 + 0.5 * f; fr2.rotation.x = 0.1 + 0.5 * f;
    return;
  }

  const w = a.run, iw = 1 - w, c = a.phase;
  body.position.y += Math.sin(t * 2.4 + s) * 0.008 * iw;
  body.rotation.z = Math.sin(t * 1.1 + s) * 0.02 * iw;
  body.rotation.x = Math.sin(c) * 0.12 * w;
  head.rotation.y = Math.sin(t * 0.9 + s) * 0.25 * iw;
  head.rotation.x = Math.sin(t * 0.5 + s) * 0.08 * iw + (0.12 - Math.sin(c) * 0.12) * w;
  tail.rotation.x = 0.5 + Math.sin(t * 3 + s) * 0.1 * iw + (-0.2 + Math.sin(c) * 0.2) * w;
  tail.rotation.y = Math.sin(t * 2.3 + s) * 0.3 * iw;
  tail2.rotation.x = 0.25 + Math.sin(t * 3 + s + 0.8) * 0.15 * iw + Math.sin(c + 0.6) * 0.2 * w;
  const A = 0.7 * w;   // gallop: front pair near in phase, back pair opposite
  const s0 = Math.sin(c), s1 = Math.sin(c + 0.5), s2 = Math.sin(c + 0.3), s3 = Math.sin(c + 0.8);
  fl.rotation.x = s0 * A;
  fr.rotation.x = s1 * A;
  bl.rotation.x = -s2 * A;
  brr.rotation.x = -s3 * A;
  // lower legs fold on the backswing (front) / forward reach (back), straighten to plant
  fl2.rotation.x = 0.1 * iw + Math.max(0, s0) * 0.9 * w;
  fr2.rotation.x = 0.1 * iw + Math.max(0, s1) * 0.9 * w;
  bl2.rotation.x = -0.1 * iw - Math.max(0, -s2) * 0.8 * w;
  br2.rotation.x = -0.1 * iw - Math.max(0, -s3) * 0.8 * w;
  root.position.y = (0.5 - 0.5 * Math.cos(c)) * 0.07 * w;
}

// ---------------------------------------------------------------- bird

function wings(wl, wr, up) { wl.rotation.z = up; wr.rotation.z = -up; }

function poseBird(r, anim, t, ph, a) {
  const P = r.parts, root = r.root;
  const body = P.torso, head = P.head, wl = P.wingL, wr = P.wingR, ll = P.legL, lr = P.legR;
  const s = a.seed;

  if (anim === 'die') {
    const k = Math.min(1, ph / DIE_TIME), e = k * k;
    root.rotation.z = 1.4 * e;
    root.position.y = 0.06 * e;
    head.rotation.x = 0.4 * e;
    wings(wl, wr, lerp(-0.35, 0.8, e));
    ll.rotation.x = -0.7 * e; lr.rotation.x = -0.5 * e;
    return;
  }

  if (anim === 'attack') {
    const p = ph % ATTACK_PERIOD.bird;
    let k, bx, hx, wu, rz;
    if (p < 0.12) {
      k = ease(p / 0.12);
      bx = -0.25 * k; hx = -0.45 * k; wu = lerp(-0.35, 0.5, k); rz = -0.05 * k;
    } else if (p < 0.22) {
      k = ease((p - 0.12) / 0.1);
      bx = lerp(-0.25, 0.45, k); hx = lerp(-0.45, 0.5, k); wu = lerp(0.5, -0.1, k); rz = lerp(-0.05, 0.14, k);
    } else {
      k = ease((p - 0.22) / (ATTACK_PERIOD.bird - 0.22));
      bx = lerp(0.45, 0, k); hx = lerp(0.5, 0, k); wu = lerp(-0.1, -0.35, k); rz = lerp(0.14, 0, k);
    }
    body.rotation.x = bx; head.rotation.x = hx; root.position.z = rz;
    wings(wl, wr, wu);
    return;
  }

  if (anim === 'cast') {
    const k = ease(ph / 0.2);
    head.rotation.x = -0.6 * k;
    body.rotation.x = -0.15 * k;
    wings(wl, wr, lerp(-0.35, 1.0, k) + Math.sin(t * 14) * 0.08 * k);
    return;
  }

  if (anim === 'hit' && ph < 0.3) {
    const f = Math.sin(ph / 0.3 * Math.PI);
    root.position.z = -0.12 * f;
    body.rotation.x = -0.35 * f;
    head.rotation.x = -0.3 * f;
    wings(wl, wr, -0.35 + 1.2 * f);
    return;
  }

  // idle hops every ~1.5 s; run = flapping just above the ground with the legs trailing
  const w = a.run, iw = 1 - w, c = a.phase;
  const h = (t * 0.66 + s) % 1;
  const hop = h < 0.25 ? Math.sin(h * 4 * Math.PI) : 0;
  root.position.y = hop * 0.09 * iw + (0.14 + Math.sin(c * 0.5) * 0.04) * w;
  body.rotation.x = Math.sin(t * 2.6 + s) * 0.02 * iw + 0.3 * w;
  head.rotation.x = Math.sin(t * 4 + s) * 0.08 * iw - 0.25 * w;
  head.rotation.y = Math.sin(t * 1.7 + s) * 0.35 * iw;
  wings(wl, wr, (-0.35 + hop * 0.9) * iw + Math.sin(c) * 0.95 * w);
  const lg = 0.5 * hop * iw + 0.9 * w;
  ll.rotation.x = lg; lr.rotation.x = lg;
}
