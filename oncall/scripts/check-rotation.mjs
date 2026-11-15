/**
 * Checks the rotation generator without loading the app:
 *
 *   node scripts/check-rotation.mjs
 *
 * Exits non-zero if any property fails.
 */
import { generateRotation, spreadByRole, shiftId } from "../src/rotation.js";

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed += 1;
};

const people = [
  ...["Ann", "Bo", "Cy", "Di", "Ed"].map((n, i) => ({ id: `rn${i}`, name: n, role: "OR RN" })),
  ...["Flo", "Gus", "Hal"].map((n, i) => ({ id: `st${i}`, name: n, role: "Scrub Tech" })),
  { id: "pacu0", name: "Ivy", role: "PACU RN" },
];
const slots = [
  { role: "OR RN", kind: "first", time: "2100-0700" },
  { role: "OR RN", kind: "second", time: "2300-0700" },
  { role: "Scrub Tech", kind: "first", time: "2100-0700" },
  { role: "PACU RN", kind: "first", time: "2300-0700" },
];
const poolFor = (slot) => people.filter((p) => p.role === slot.role);
const roleOf = (id) => people.find((p) => p.id === id).role;
const base = { slots, slotIndexes: [0, 1, 2, 3], poolFor, startKey: "2026-11-15", days: 28 };

const r = generateRotation(base);
check("fills every slot every day", r.shifts.length === 28 * 4, `${r.shifts.length} shifts`);
check("no warnings when pools are adequate", r.warnings.length === 0, JSON.stringify(r.warnings.slice(0, 2)));

const byDay = {};
r.shifts.forEach((s) => ((byDay[s.date] ||= []).push(s.personId)));
// Ivy is the only PACU nurse so she works daily; nobody should hold two slots.
check("nobody holds two slots in a day", Object.values(byDay).every((ids) => new Set(ids).size === ids.length));

const spread = spreadByRole(r.tally, roleOf);
const rn = spread.find((s) => s.role === "OR RN");
const st = spread.find((s) => s.role === "Scrub Tech");
check("OR RN points within 1.5 of each other", rn.gap <= 1.5, `min ${rn.min} max ${rn.max}`);
check("Scrub Tech points within 1.5 of each other", st.gap <= 1.5, `min ${st.min} max ${st.max}`);

const weekends = r.tally.filter((t) => roleOf(t.personId) === "OR RN").map((t) => t.weekends);
check("OR RN weekend shifts within 1 of each other", Math.max(...weekends) - Math.min(...weekends) <= 1, weekends.join(","));

const backToBack = r.shifts.filter((s) => roleOf(s.personId) === "OR RN").some((s) => {
  const d = new Date(s.date + "T00:00");
  d.setDate(d.getDate() + 1);
  const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return (byDay[next] || []).includes(s.personId);
});
check("OR RNs are not on consecutive days (5 people, 2 slots)", !backToBack);

const ex = generateRotation({ ...base, excluded: new Set(["rn0"]) });
check("an excluded person gets nothing", !ex.shifts.some((s) => s.personId === "rn0"));
check("excluding still fills everything", ex.shifts.length === 28 * 4);

const lockId = shiftId("2026-11-20", 0);
const lk = generateRotation({ ...base, locked: { [lockId]: { id: lockId, date: "2026-11-20", role: "OR RN", kind: "first", time: "2100-0700", personId: "rn4", posted: true, outSick: false } } });
const kept = lk.shifts.find((s) => s.id === lockId);
check("a locked shift keeps its person and flags", kept.personId === "rn4" && kept.posted === true);
check("the locked person is not doubled that day", lk.shifts.filter((s) => s.date === "2026-11-20" && s.personId === "rn4").length === 1);

const again = generateRotation({ ...base, offset: 1 });
check("regenerating changes who goes first", again.shifts[0].personId !== r.shifts[0].personId);
check("same inputs give the same schedule", JSON.stringify(generateRotation(base).shifts) === JSON.stringify(r.shifts));

const none = generateRotation({ ...base, excluded: new Set(["pacu0"]) });
check("an empty pool is reported, not silently skipped", none.warnings.filter((w) => w.type === "unfilled").length === 28);

const tiny = generateRotation({ ...base, excluded: new Set(["rn1", "rn2", "rn3", "rn4"]) });
check("a pool too small to avoid doubling says so", tiny.warnings.some((w) => w.type === "double"));

process.exit(failed ? 1 : 0);
