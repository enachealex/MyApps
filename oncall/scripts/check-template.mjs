/**
 * Checks the call-template logic (src/template.js) and that the rotation
 * generator keys shifts by slot id rather than position.
 *
 *   node scripts/check-template.mjs      (npm run test:template)
 */
import { scopeOf, isOrgAdmin, canManageRole, managedRoles, canManagePerson, departmentsOf, rolesInDept, inDept, moved, withSlotIds, effectiveOrg, validateTemplate, reconcileShifts, unfilledSlots, callButtonAllowed, slotIdOf } from "../src/template.js";
import { generateRotation } from "../src/rotation.js";

let failed = 0;
let count = 0;
const check = (name, ok) => {
  count += 1;
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
};

const base = {
  id: "t",
  roles: ["OR RN", "Scrub Tech", "PACU RN"],
  depts: { "OR RN": "OR", "Scrub Tech": "OR", "PACU RN": "PACU" },
  aliases: {},
  slots: [
    { role: "OR RN", kind: "first", time: "1900-0700" },
    { role: "OR RN", kind: "second", time: "2300-0700" },
    { role: "Scrub Tech", kind: "first", time: "1900-0700" },
  ],
};
const people = [
  { id: "a", name: "A", role: "OR RN", kind: "staff" },
  { id: "b", name: "B", role: "OR RN", kind: "staff" },
  { id: "c", name: "C", role: "Scrub Tech", kind: "staff" },
  { id: "m", name: "M", role: "Nurse Manager", kind: "manager" },
];

/* ---- identity ---- */
const ids = withSlotIds(base.slots).map((s) => s.id);
check("unlabelled slots take their position as id", ids.join() === "0,1,2");
check("existing ids are kept", withSlotIds([{ id: "sx", role: "r" }, { role: "r" }]).map((s) => s.id).join() === "sx,1");
check("slot id is read back from a shift id", slotIdOf("2026-11-20~sx") === "sx" && slotIdOf("2026-11-20~2") === "2");

/* ---- overlay ---- */
const plain = effectiveOrg(base, null);
check("no settings: the original template, with ids", plain.roles.length === 3 && plain.slots[2].id === "2");
check("no settings: phone buttons on for everyone", plain.callButton.desktop && plain.callButton.mobile && plain.callButton.who === "everyone");
const edited = effectiveOrg(base, { roles: ["OR RN"], slots: [{ id: "0", role: "OR RN", kind: "first", time: "1800-0600" }], depts: { "OR RN": "Main OR" }, callButton: { desktop: false } });
check("settings replace roles, slots and departments", edited.roles.length === 1 && edited.slots[0].time === "1800-0600" && edited.depts["OR RN"] === "Main OR");
check("a partial phone setting keeps the other defaults", edited.callButton.desktop === false && edited.callButton.mobile === true);
check("the original is not modified", base.slots[0].time === "1900-0700" && base.slots[0].id === undefined);

/* ---- validation ---- */
const ok = (t) => validateTemplate({ aliases: {}, ...t }, people);
check("the starting template is valid", ok(plain).length === 0);
check("a blank role name is refused", ok({ ...plain, roles: [...plain.roles, " "] }).length > 0);
check("a duplicate role is refused, whatever the capitals", ok({ ...plain, roles: [...plain.roles, "or rn"] }).length > 0);
check("removing a role people still hold is refused", ok({ ...plain, roles: ["OR RN", "PACU RN"], slots: plain.slots.slice(0, 2) }).some((p) => p.includes("Scrub Tech")));
check("removing a role nobody holds is fine", ok({ ...plain, roles: ["OR RN", "Scrub Tech"] }).length === 0);
check("a manager's title is not treated as a missing role", !ok(plain).some((p) => p.includes("Nurse Manager")));
check("a slot for a role that does not exist is refused", ok({ ...plain, slots: [...plain.slots, { id: "9", role: "Ghost", kind: "first", time: "1900-0700" }] }).length > 0);
check("hours in the wrong shape are refused", ok({ ...plain, slots: [{ id: "0", role: "OR RN", kind: "first", time: "7pm-7am" }] }).length > 0);
check("an impossible hour is refused", ok({ ...plain, slots: [{ id: "0", role: "OR RN", kind: "first", time: "2500-0700" }] }).length > 0);
check("the same slot twice is refused", ok({ ...plain, slots: [...plain.slots, { id: "9", role: "OR RN", kind: "first", time: "1900-0700" }] }).length > 0);
check(
  "a role others draw their staff from cannot be removed",
  validateTemplate({ roles: ["Anes MD Backup"], slots: [], aliases: { "Anes MD Backup": "Anes MD" } }, []).length > 0
);

/* ---- reconciling the schedule ---- */
const today = "2026-11-17";
const mk = (date, slot, role, time, kind, personId) => ({ id: `${date}~${slot}`, date, role, time, kind, personId, posted: false, outSick: false });
const shifts = [
  mk("2026-11-16", "1", "OR RN", "2300-0700", "second", "a"), // yesterday
  mk("2026-11-17", "0", "OR RN", "1900-0700", "first", "a"),
  mk("2026-11-17", "1", "OR RN", "2300-0700", "second", "b"),
  mk("2026-11-18", "1", "OR RN", "2300-0700", "second", "a"),
  mk("2026-11-18", "2", "Scrub Tech", "1900-0700", "first", "c"),
];
const slots2 = [
  { id: "0", role: "OR RN", kind: "first", time: "1800-0600" }, // hours changed
  { id: "2", role: "Scrub Tech", kind: "first", time: "1900-0700" }, // unchanged
  { id: "sn", role: "PACU RN", kind: "first", time: "2300-0700" }, // new
]; // slot 1 removed
const r = reconcileShifts(shifts, slots2, today, new Set(["2026-11-18~1"]));
const has = (id) => r.shifts.find((s) => s.id === id);
check("yesterday's shift on a removed slot stays as a record", !!has("2026-11-16~1"));
check("a coming shift on a removed slot is taken off", !has("2026-11-17~1") && r.removed === 1);
check("a removed slot's shift with an open request is kept", !!has("2026-11-18~1") && r.kept === 1);
check("changed hours reach the coming shifts", has("2026-11-17~0").time === "1800-0600" && r.updated === 1);
check("who holds the shift does not change", has("2026-11-17~0").personId === "a");
check("an untouched slot's shifts are the same objects", has("2026-11-18~2") === shifts[4]);
check("the new slot is reported as having nothing scheduled", unfilledSlots(r.shifts, slots2, today).map((s) => s.id).join() === "sn");
const same = reconcileShifts(shifts, plain.slots, today);
check("saving an unchanged template changes nothing", same.removed === 0 && same.updated === 0 && same.shifts.every((s, i) => s === shifts[i]));

/* ---- generator uses slot ids ---- */
const tpl = withSlotIds([{ id: "sn", role: "OR RN", kind: "first", time: "1900-0700" }, { role: "Scrub Tech", kind: "first", time: "1900-0700" }]);
const gen = generateRotation({ slots: tpl, slotIndexes: [0, 1], poolFor: (slot) => people.filter((p) => p.kind === "staff" && p.role === slot.role), startKey: today, days: 3 });
check("generated shifts are keyed by slot id", gen.shifts.some((s) => s.id === `${today}~sn`) && gen.shifts.some((s) => s.id === `${today}~1`));
const legacy = generateRotation({ slots: base.slots, slotIndexes: [0], poolFor: () => people.slice(0, 2), startKey: today, days: 1 });
check("a template with no ids still keys by position", legacy.shifts[0].id === `${today}~0`);
const lockedShift = mk(today, "sn", "OR RN", "1900-0700", "first", "b");
const genLocked = generateRotation({ slots: tpl, slotIndexes: [0], poolFor: () => people.slice(0, 2), startKey: today, days: 1, locked: { [lockedShift.id]: lockedShift } });
check("a locked shift on an id'd slot is left alone", genLocked.shifts.length === 1 && genLocked.shifts[0].personId === "b");

/* ---- phone buttons ---- */
const cb = (s, canDial, viewerKind) => callButtonAllowed(s, { canDial, viewerKind });
check("by default everyone gets the button everywhere", cb(undefined, true, "staff") && cb(undefined, false, "staff"));
check("off on desktop leaves phones alone", !cb({ desktop: false }, false, "staff") && cb({ desktop: false }, true, "staff"));
check("off on mobile leaves desktop alone", !cb({ mobile: false }, true, "manager") && cb({ mobile: false }, false, "manager"));
check("managers-only hides it from staff", !cb({ who: "managers" }, true, "staff"));
check("managers-only keeps it for supervisors and admins", cb({ who: "managers" }, true, "supervisor") && cb({ who: "managers" }, true, "manager"));

/* ---- departments ---- */
check("departments come out in role order, once each", departmentsOf(base).join() === "OR,PACU");
check("a role with no department is filed under Other", departmentsOf({ roles: ["A", "B"], depts: { A: "X" } }).join() === "X,Other");
check("a department narrows the roles", rolesInDept(base, "OR").join() === "OR RN,Scrub Tech" && rolesInDept(base, "All").length === 3);
check("a department narrows the shifts", shifts.filter(inDept(base, "OR")).length === 5 && shifts.filter(inDept(base, "PACU")).length === 0 && shifts.filter(inDept(base, "All")).length === 5);
check("moving a role up swaps it with its neighbour", moved(["a", "b", "c"], 2, -1).join() === "a,c,b");
check("moving past either end changes nothing", moved(["a", "b"], 0, -1).join() === "a,b" && moved(["a", "b"], 1, 1).join() === "a,b");

/* ---- who manages what ---- */
const adminP = { id: "m", kind: "manager" };
const orMgr = { id: "dm", kind: "manager", depts: ["OR"] };
const supP = { id: "s", kind: "supervisor", depts: ["OR"] };
check("an Admin with no departments runs everything", isOrgAdmin(adminP) && managedRoles(base, adminP).length === 3);
check("a department manager is not an organization Admin", !isOrgAdmin(orMgr));
check("a department manager manages only their roles", managedRoles(base, orMgr).join() === "OR RN,Scrub Tech" && !canManageRole(base, orMgr, "PACU RN"));
check("departments listed on a supervisor grant nothing", scopeOf(supP).length === 0 && !canManageRole(base, supP, "OR RN"));
check("staff manage nothing", !canManageRole(base, people[0], "OR RN"));
check("a department manager edits their own staff", canManagePerson(base, orMgr, people[0]));
check("a department manager cannot edit another department's staff", !canManagePerson(base, orMgr, { kind: "staff", role: "PACU RN" }));
check("a department manager cannot edit a manager or supervisor", !canManagePerson(base, orMgr, adminP) && !canManagePerson(base, orMgr, { kind: "supervisor", role: "OR RN" }));
check("an Admin edits anyone", canManagePerson(base, adminP, orMgr) && canManagePerson(base, adminP, people[0]));

console.log(`\n${count - failed} of ${count} checks passed`);
process.exit(failed ? 1 : 0);
