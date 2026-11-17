/**
 * The call template an Admin can edit: which roles exist, which department
 * each belongs to, which call slots are filled every day, and how the phone
 * buttons behave.
 *
 * An organization is created with a template by the operator. Whatever the
 * Admin changes afterwards is stored as one settings record in the tenant's
 * own data and laid over that starting point, so the operator's record is
 * never edited from inside the app.
 *
 * Pure functions, no React and no storage, checked by
 * scripts/check-template.mjs.
 */

export const SETTINGS_ID = "call";

export const DEFAULT_CALL_BUTTON = { desktop: true, mobile: true, who: "everyone" };

const TIME = /^([01]\d|2[0-3])[0-5]\d-([01]\d|2[0-3])[0-5]\d$/;
export const KINDS = ["first", "second", "work"];

/* A slot needs an identity that survives the list being edited, because a
   shift's id is its date plus its slot. Templates written before slots had
   ids used the position in the list, so that is what an unlabelled slot gets —
   which keeps every shift already in the database pointing at the right row. */
export const withSlotIds = (slots = []) => slots.map((s, i) => (s.id === undefined || s.id === null || s.id === "" ? { ...s, id: String(i) } : { ...s, id: String(s.id) }));

export const newSlotId = () => `s${Math.random().toString(36).slice(2, 8)}`;

/* The slot a shift was generated from: everything after the date. */
export const slotIdOf = (shiftId) => {
  const at = String(shiftId).indexOf("~");
  return at < 0 ? null : String(shiftId).slice(at + 1);
};

export function settingsOf(db) {
  return ((db && db.settings) || []).find((s) => s.id === SETTINGS_ID) || null;
}

/* The organization as the screens should see it: the Admin's edits over the
   template it was created with. */
export function effectiveOrg(org, settings) {
  const s = settings || {};
  return {
    ...org,
    roles: Array.isArray(s.roles) ? s.roles : org.roles || [],
    depts: s.depts && typeof s.depts === "object" ? s.depts : org.depts || {},
    slots: withSlotIds(Array.isArray(s.slots) ? s.slots : org.slots || []),
    callButton: { ...DEFAULT_CALL_BUTTON, ...(org.callButton || {}), ...(s.callButton || {}) },
  };
}

/**
 * What is wrong with a template, in words an Admin can act on. Empty means it
 * can be saved.
 */
export function validateTemplate({ roles = [], slots = [], aliases = {} }, people = []) {
  const problems = [];
  const names = roles.map((r) => String(r).trim());

  if (names.some((r) => !r)) problems.push("Every role needs a name.");
  const seen = new Set();
  names.forEach((r) => {
    const k = r.toLowerCase();
    if (r && seen.has(k)) problems.push(`"${r}" is listed twice.`);
    seen.add(k);
  });

  /* Someone whose role no longer exists would drop out of every pool without
     anyone being told, so a role in use cannot simply be removed. Managers and
     supervisors carry titles rather than call roles and are not counted. */
  const held = new Map();
  people.forEach((p) => {
    if (p.kind === "staff") held.set(p.role, (held.get(p.role) || 0) + 1);
  });
  held.forEach((count, role) => {
    if (!names.includes(role)) problems.push(`${count} ${count === 1 ? "person is" : "people are"} still listed as ${role}. Move them to another role before removing it.`);
  });
  Object.entries(aliases).forEach(([role, source]) => {
    if (names.includes(role) && !names.includes(source)) problems.push(`${role} is covered by the ${source} staff, so ${source} cannot be removed while ${role} exists.`);
  });

  const slotSeen = new Set();
  slots.forEach((s) => {
    if (!names.includes(s.role)) problems.push(`A call slot is set to "${s.role}", which is not one of the roles.`);
    if (!KINDS.includes(s.kind)) problems.push(`${s.role}: pick 1st call, 2nd call or work shift.`);
    if (!TIME.test(String(s.time || ""))) problems.push(`${s.role}: write the hours as four digits each, like 1900-0700.`);
    const k = `${s.role}|${s.kind}|${s.time}`;
    if (slotSeen.has(k)) problems.push(`${s.role} has the same slot twice (${s.time}).`);
    slotSeen.add(k);
  });

  return [...new Set(problems)];
}

/**
 * Brings the schedule into line with an edited template, from today onwards.
 *
 *   - a slot that was removed loses its coming shifts;
 *   - a slot whose hours or call level changed has its coming shifts updated;
 *   - a new slot gets nothing here — the Admin generates a rotation for it.
 *
 * Days before today are a record of who was on call and are never touched. A
 * shift with an open request stays whatever happens to its slot, because
 * removing it would strand a conversation two people are in the middle of.
 *
 * Returns { shifts, removed, updated, kept }.
 */
export function reconcileShifts(shifts, slots, todayKey, lockedIds = new Set()) {
  const byId = new Map(withSlotIds(slots).map((s) => [s.id, s]));
  let removed = 0;
  let updated = 0;
  let kept = 0;
  const next = [];

  shifts.forEach((shift) => {
    const slotId = slotIdOf(shift.id);
    if (shift.date < todayKey || slotId === null) {
      next.push(shift);
      return;
    }
    const slot = byId.get(slotId);
    if (!slot || slot.role !== shift.role) {
      if (lockedIds.has(shift.id)) {
        kept += 1;
        next.push(shift);
      } else {
        removed += 1;
      }
      return;
    }
    if (slot.time !== shift.time || slot.kind !== shift.kind) {
      updated += 1;
      next.push({ ...shift, time: slot.time, kind: slot.kind });
      return;
    }
    next.push(shift);
  });

  return { shifts: next, removed, updated, kept };
}

/* Which slots have nothing scheduled from today on — new ones, usually. */
export function unfilledSlots(shifts, slots, todayKey) {
  const filled = new Set(shifts.filter((s) => s.date >= todayKey).map((s) => slotIdOf(s.id)));
  return withSlotIds(slots).filter((s) => !filled.has(s.id));
}

/**
 * Whether the phone number is a button for this viewer on this device.
 * `canDial` is true on a device with a real dialer; that, not the width of
 * the window, is what "mobile" means here.
 */
export function callButtonAllowed(callButton, { canDial, viewerKind }) {
  const cb = { ...DEFAULT_CALL_BUTTON, ...(callButton || {}) };
  if (!(canDial ? cb.mobile : cb.desktop)) return false;
  if (cb.who === "managers" && viewerKind !== "manager" && viewerKind !== "supervisor") return false;
  return true;
}

/* ---- departments ---- */

export const ALL_DEPTS = "All";
const NO_DEPT = "Other";

export const deptOfRole = (org, role) => (org.depts && org.depts[role]) || NO_DEPT;

/* Departments in the order their first role appears, so the list reads the
   way the Admin laid the roles out. "Other" only when some role has none. */
export function departmentsOf(org) {
  const seen = [];
  (org.roles || []).forEach((r) => {
    const d = deptOfRole(org, r);
    if (!seen.includes(d)) seen.push(d);
  });
  return seen;
}

/* The roles a department filter leaves in view. A shift whose role has since
   been removed from the template still belongs somewhere, so it is matched by
   its own role rather than dropped. */
export function rolesInDept(org, dept) {
  if (!dept || dept === ALL_DEPTS) return org.roles || [];
  return (org.roles || []).filter((r) => deptOfRole(org, r) === dept);
}

export const inDept = (org, dept) => (shift) => !dept || dept === ALL_DEPTS || deptOfRole(org, shift.role) === dept;

/* Moves one item of a list a place up or down; out-of-range leaves it alone. */
export function moved(list, index, by) {
  const to = index + by;
  if (index < 0 || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}
