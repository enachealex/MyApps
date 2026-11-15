/**
 * Rotation generator: fills a block of days from a call template.
 *
 * This is deliberately not an optimiser. It walks the block a day at a time
 * and gives each slot to whoever in that slot's pool is carrying the least so
 * far, which is the part of "auto-scheduling" the evidence actually supports —
 * an even spread of call, with weekends counted separately because they are
 * what people argue about. A human then adjusts and publishes.
 *
 * Pure functions, no React and no storage, so the behaviour can be checked
 * from a script (scripts/check-rotation.mjs) without loading the app.
 */

/* Weekend call weighs more than a weeknight. One number rather than a rules
   screen for now; departments that disagree can be given the dial later. */
export const WEEKEND_WEIGHT = 1.5;

const pad = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

export const shiftId = (dateKey, slotIndex) => `${dateKey}~${slotIndex}`;

/**
 * @param {object}   o
 * @param {Array}    o.slots       the org's call template; index is identity
 * @param {number[]} o.slotIndexes which template rows to fill
 * @param {Function} o.poolFor     (slot) => people eligible for it, in roster order
 * @param {string}   o.startKey    first day, YYYY-MM-DD
 * @param {number}   o.days        how many days to fill
 * @param {Set}      [o.excluded]  person ids left out of this block entirely
 * @param {object}   [o.locked]    shiftId -> existing shift that must not move
 *                                 (it has an open request); still counted
 * @param {number}   [o.offset]    rotates who goes first; "regenerate" bumps it
 */
function buildOnce({ slots, slotIndexes, poolFor, startKey, days, excluded = new Set(), locked = {}, offset = 0 }) {
  const tally = new Map(); // personId -> { shifts, weekends, points, last }
  const bump = (id, date, dayIndex) => {
    const t = tally.get(id) || { shifts: 0, weekends: 0, points: 0, last: -Infinity };
    const weekend = isWeekend(date);
    t.shifts += 1;
    if (weekend) t.weekends += 1;
    t.points += weekend ? WEEKEND_WEIGHT : 1;
    t.last = dayIndex;
    tally.set(id, t);
  };

  const shifts = [];
  const warnings = [];
  const start = fromKey(startKey);

  for (let i = 0; i < days; i += 1) {
    const date = addDays(start, i);
    const dateKey = keyOf(date);
    const takenToday = new Set();

    /* Locked shifts first, so the people already committed today are known
       before anyone else is placed around them. */
    slotIndexes.forEach((si) => {
      const keep = locked[shiftId(dateKey, si)];
      if (keep) {
        takenToday.add(keep.personId);
        bump(keep.personId, date, i);
      }
    });

    slotIndexes.forEach((si) => {
      const slot = slots[si];
      const id = shiftId(dateKey, si);
      if (locked[id]) {
        shifts.push({ ...locked[id] });
        return;
      }

      const pool = poolFor(slot).filter((p) => !excluded.has(p.id) && p.active !== false);
      if (pool.length === 0) {
        warnings.push({ type: "unfilled", dateKey, slotIndex: si, text: `${slot.role} ${slot.time}: nobody available` });
        return;
      }

      /* Rotating the pool by day and offset decides ties, so two people with
         equal load alternate instead of the first name always winning. */
      const order = pool.map((p, idx) => ({ p, rank: (idx - i - offset + pool.length * 1000) % pool.length }));

      const weekend = isWeekend(date);
      const score = ({ p, rank }) => {
        const t = tally.get(p.id) || { points: 0, weekends: 0, last: -Infinity };
        return [
          takenToday.has(p.id) ? 1 : 0, // never two slots in a day if avoidable
          t.last === i - 1 ? 1 : 0, // then avoid back-to-back days
          /* On a weekend, weekends are shared out before total load. Points
             alone balance the totals and still let one person collect most of
             the Saturdays, which is the unfairness people actually notice. */
          weekend ? t.weekends : 0,
          t.points, // then whoever carries least
          rank, // then the rotation
        ];
      };
      order.sort((a, b) => {
        const sa = score(a);
        const sb = score(b);
        for (let k = 0; k < sa.length; k += 1) if (sa[k] !== sb[k]) return sa[k] - sb[k];
        return 0;
      });

      const pick = order[0].p;
      if (takenToday.has(pick.id)) {
        warnings.push({ type: "double", dateKey, slotIndex: si, text: `${pick.name} holds two slots on ${dateKey} — the ${slot.role} pool is too small to avoid it` });
      }
      takenToday.add(pick.id);
      bump(pick.id, date, i);
      shifts.push({ id, date: dateKey, role: slot.role, kind: slot.kind, time: slot.time, personId: pick.id, posted: false, outSick: false });
    });
  }

  return { shifts, warnings, tally: summarise(tally) };
}

/* How lopsided a candidate is, per pool: weekend gap counts double because it
   is the complaint, and anyone eligible who got nothing counts as zero. */
function unevenness(result, { slots, slotIndexes, poolFor, excluded = new Set() }) {
  const byId = new Map(result.tally.map((t) => [t.personId, t]));
  const seen = new Set();
  let total = result.warnings.length * 100;
  slotIndexes.forEach((si) => {
    const role = slots[si].role;
    if (seen.has(role)) return;
    seen.add(role);
    const pool = poolFor(slots[si]).filter((p) => !excluded.has(p.id) && p.active !== false);
    if (pool.length < 2) return;
    const pts = pool.map((p) => (byId.get(p.id) || { points: 0 }).points);
    const wk = pool.map((p) => (byId.get(p.id) || { weekends: 0 }).weekends);
    total += Math.max(...pts) - Math.min(...pts) + 2 * (Math.max(...wk) - Math.min(...wk));
  });
  return total;
}

/* A single greedy pass cannot see that giving someone Friday rules them out of
   the weekend, so it can leave weekends lopsided. Rather than add look-ahead,
   run the same pass from several starting rotations and keep the most even.
   Each "regenerate" moves to a fresh window of starting points, so it gives a
   genuinely different schedule and stays repeatable for the same inputs. */
const TRIES = 7;
export function generateRotation(options) {
  const base = (options.offset || 0) * TRIES;
  let best = null;
  let bestScore = Infinity;
  for (let k = 0; k < TRIES; k += 1) {
    const candidate = buildOnce({ ...options, offset: base + k });
    const score = unevenness(candidate, options);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return repair(best, options);
}

function tallyOf(shifts) {
  const t = new Map();
  shifts.forEach((s) => {
    const row = t.get(s.personId) || { shifts: 0, weekends: 0, points: 0 };
    const weekend = isWeekend(fromKey(s.date));
    row.shifts += 1;
    if (weekend) row.weekends += 1;
    row.points += weekend ? WEEKEND_WEIGHT : 1;
    t.set(s.personId, row);
  });
  return summarise(t);
}

/* Trade people between two shifts of the same role whenever it evens things
   out and breaks nothing: nobody ends up on twice in a day or on consecutive
   days, and shifts with an open request stay where they are. Plain hill
   climbing — it stops at the first arrangement no single trade improves. */
function repair(result, options) {
  const { locked = {} } = options;
  const shifts = result.shifts.map((s) => ({ ...s }));
  const dayNumber = (k) => Math.round(fromKey(k).getTime() / 86400000);

  const clashes = (personId, shift, ignore) =>
    shifts.some((o) => o !== shift && o !== ignore && o.personId === personId && Math.abs(dayNumber(o.date) - dayNumber(shift.date)) <= 1);

  let score = unevenness({ tally: tallyOf(shifts), warnings: result.warnings }, options);
  for (let pass = 0; pass < 20; pass += 1) {
    let improved = false;
    for (let a = 0; a < shifts.length; a += 1) {
      for (let b = a + 1; b < shifts.length; b += 1) {
        const x = shifts[a];
        const y = shifts[b];
        if (x.role !== y.role || x.personId === y.personId || locked[x.id] || locked[y.id]) continue;
        if (clashes(y.personId, x, y) || clashes(x.personId, y, x)) continue;
        [x.personId, y.personId] = [y.personId, x.personId];
        const next = unevenness({ tally: tallyOf(shifts), warnings: result.warnings }, options);
        if (next < score - 1e-9) {
          score = next;
          improved = true;
        } else {
          [x.personId, y.personId] = [y.personId, x.personId];
        }
      }
    }
    if (!improved) break;
  }
  return { shifts, warnings: result.warnings, tally: tallyOf(shifts) };
}

function summarise(tally) {
  const rows = [...tally.entries()].map(([personId, t]) => ({ personId, shifts: t.shifts, weekends: t.weekends, points: t.points }));
  return rows.sort((a, b) => b.points - a.points);
}

/* How uneven a block is within each role, which is the only comparison that
   means anything: an OR nurse and an anaesthetist are not sharing a load. */
export function spreadByRole(tallyRows, roleOf) {
  const groups = new Map();
  tallyRows.forEach((r) => {
    const role = roleOf(r.personId);
    if (!groups.has(role)) groups.set(role, []);
    groups.get(role).push(r.points);
  });
  return [...groups.entries()]
    .map(([role, pts]) => ({ role, people: pts.length, min: Math.min(...pts), max: Math.max(...pts), gap: Math.max(...pts) - Math.min(...pts) }))
    .sort((a, b) => b.gap - a.gap);
}
