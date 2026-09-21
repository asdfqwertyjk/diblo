// shared/sim/stats.js — derived vitals from class tables and a character document.
import classes from '../data/classes.js';

export function classOf(doc) {
  const c = classes.classes[doc.cls];
  if (!c) throw new Error('unknown class ' + doc.cls);
  return c;
}

/** hpMax, mpMax, speed, radius for a character document {cls, level, stats?}. */
export function deriveVitals(doc) {
  const c = classOf(doc);
  const st = doc.stats || c.stats;
  const L = doc.level || 1;
  return {
    hpMax: Math.floor(c.life.base + c.life.perLevel * (L - 1) + c.life.perVit * st.vit),
    mpMax: Math.floor(c.mana.base + c.mana.perLevel * (L - 1) + c.mana.perEne * st.ene),
    speed: c.runSpeed,
    radius: c.radius,
  };
}
