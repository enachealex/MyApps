/**
 * Security-rule tests, run against the Firestore emulator:
 *
 *   npm run test:rules
 *
 * Each case states who is asking and whether it should be allowed. The ones
 * that matter most are the refusals — a rule that lets the right person in
 * proves little; the product is the wrong person being kept out.
 */
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where } from "firebase/firestore";
import { readFileSync } from "node:fs";

const env = await initializeTestEnvironment({
  projectId: "demo-oncall",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8787 },
});

let failed = 0;
let count = 0;
async function expect(name, allowed, op) {
  count += 1;
  try {
    await (allowed ? assertSucceeds(op()) : assertFails(op()));
    console.log(`ok   ${allowed ? "allow" : "deny "}  ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL ${allowed ? "allow" : "deny "}  ${name}\n       ${String(e.message).split("\n")[0]}`);
  }
}

/* ------------------------------ fixture ------------------------------ */
const A = "aurelia";
const B = "cascade";
const people = {
  admin: { id: "a-admin", email: "admin@a.test", kind: "manager" },
  sup: { id: "a-sup", email: "sup@a.test", kind: "supervisor" },
  ann: { id: "a-ann", email: "ann@a.test", kind: "staff" },
  bo: { id: "a-bo", email: "bo@a.test", kind: "staff" },
  cy: { id: "a-cy", email: "cy@a.test", kind: "staff" },
  other: { id: "b-admin", email: "admin@b.test", kind: "manager", org: B },
};

await env.clearFirestore();
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "operators/owner@platform.test"), { since: "2026" });
  for (const org of [A, B]) await setDoc(doc(db, `orgs/${org}`), { name: org, roles: ["OR RN"], slots: [] });
  for (const p of Object.values(people)) {
    const org = p.org || A;
    await setDoc(doc(db, `orgs/${org}/people/${p.id}`), { id: p.id, name: p.id, email: p.email, phone: "555-0100", kind: p.kind, active: true });
    await setDoc(doc(db, `orgs/${org}/members/${p.email}`), { personId: p.id, kind: p.kind, active: true });
    await setDoc(doc(db, `userIndex/${p.email}`), { orgId: org, personId: p.id });
  }
  await setDoc(doc(db, `orgs/${A}/members/gone@a.test`), { personId: "a-gone", kind: "staff", active: false });
  await setDoc(doc(db, `orgs/${A}/shifts/s-ann`), { id: "s-ann", date: "2026-12-01", role: "OR RN", personId: "a-ann", posted: false, outSick: false });
  await setDoc(doc(db, `orgs/${A}/shifts/s-bo`), { id: "s-bo", date: "2026-12-02", role: "OR RN", personId: "a-bo", posted: true, outSick: false });
  await setDoc(doc(db, `orgs/${A}/requests/r-open`), { id: "r-open", type: "post", shiftId: "s-bo", fromId: "a-bo", toId: null, coworker: "pending", status: "submitted" });
  await setDoc(doc(db, `orgs/${A}/requests/r-trade`), { id: "r-trade", type: "trade", shiftId: "s-ann", fromId: "a-ann", toId: "a-bo", coworker: "pending", status: "submitted" });
  await setDoc(doc(db, `orgs/${A}/timeOff/a-ann_2026-12-05`), { personId: "a-ann", date: "2026-12-05" });
  await setDoc(doc(db, `orgs/${A}/messages/m1`), { id: "m1", fromId: "a-ann", toId: "a-bo", body: "cover Friday?", at: "2026-11-16T10:00:00Z", readAt: null, reported: false });
  await setDoc(doc(db, `orgs/${A}/messages/m2`), { id: "m2", fromId: "a-bo", toId: "a-cy", body: "reported one", at: "2026-11-16T11:00:00Z", readAt: null, reported: true });
  await setDoc(doc(db, `orgs/${B}/shifts/s-b`), { id: "s-b", date: "2026-12-01", role: "OR RN", personId: "b-admin", posted: false });
});

const as = (p, verified = true) => env.authenticatedContext(p.id, { email: p.email, email_verified: verified }).firestore();
const admin = as(people.admin);
const sup = as(people.sup);
const ann = as(people.ann);
const bo = as(people.bo);
const cy = as(people.cy);
const otherAdmin = as(people.other);
const annUnverified = as(people.ann, false);
const stranger = env.authenticatedContext("x", { email: "nobody@else.test", email_verified: true }).firestore();
const gone = env.authenticatedContext("g", { email: "gone@a.test", email_verified: true }).firestore();
const owner = env.authenticatedContext("o", { email: "owner@platform.test", email_verified: true }).firestore();
const anon = env.unauthenticatedContext().firestore();

/* ------------------------- who gets in at all ------------------------- */
await expect("staff reads their own org's phone list", true, () => getDocs(collection(ann, `orgs/${A}/people`)));
await expect("signed-out visitor reads the phone list", false, () => getDocs(collection(anon, `orgs/${A}/people`)));
await expect("verified stranger with no membership reads the phone list", false, () => getDocs(collection(stranger, `orgs/${A}/people`)));
await expect("unverified account using a real member's email reads the phone list", false, () => getDocs(collection(annUnverified, `orgs/${A}/people`)));
await expect("deactivated member reads the phone list", false, () => getDocs(collection(gone, `orgs/${A}/people`)));
await expect("another tenant's admin reads this tenant's phone list", false, () => getDocs(collection(otherAdmin, `orgs/${A}/people`)));
await expect("another tenant's admin reads this tenant's shifts", false, () => getDocs(collection(otherAdmin, `orgs/${A}/shifts`)));
await expect("another tenant's admin edits this tenant's shift", false, () => updateDoc(doc(otherAdmin, `orgs/${A}/shifts/s-ann`), { personId: "b-admin" }));
await expect("staff finds their tenant through their own index entry", true, () => getDoc(doc(ann, "userIndex/ann@a.test")));
await expect("staff reads someone else's index entry", false, () => getDoc(doc(ann, "userIndex/bo@a.test")));
await expect("anyone lists the user index", false, () => getDocs(collection(ann, "userIndex")));

/* ---------------------- becoming something you are not ---------------------- */
await expect("admin adds themselves as an operator", false, () => setDoc(doc(admin, "operators/admin@a.test"), { since: "now" }));
await expect("staff promotes themselves to admin", false, () => updateDoc(doc(ann, `orgs/${A}/members/ann@a.test`), { kind: "manager" }));
await expect("admin changes their own access level", false, () => updateDoc(doc(admin, `orgs/${A}/members/admin@a.test`), { kind: "staff" }));
await expect("admin edits their own roster record", false, () => updateDoc(doc(admin, `orgs/${A}/people/a-admin`), { name: "x" }));
await expect("admin invents an access level", false, () => setDoc(doc(admin, `orgs/${A}/members/new@a.test`), { personId: "a-new", kind: "owner", active: true }));
await expect("admin creates a second organization", false, () => setDoc(doc(admin, "orgs/mine-too"), { name: "x" }));
await expect("admin edits their own organization record", false, () => updateDoc(doc(admin, `orgs/${A}`), { name: "renamed" }));
await expect("admin grants membership in another tenant", false, () => setDoc(doc(admin, `orgs/${B}/members/ann@a.test`), { personId: "a-ann", kind: "manager", active: true }));
await expect("admin repoints another tenant's person at their own tenant", false, () => setDoc(doc(admin, "userIndex/admin@b.test"), { orgId: A, personId: "a-x" }));
await expect("admin files an index entry in another tenant", false, () => setDoc(doc(admin, "userIndex/fresh@b.test"), { orgId: B, personId: "b-x" }));
await expect("staff lists the membership table", false, () => getDocs(collection(ann, `orgs/${A}/members`)));

/* --------------------------- what an admin can do --------------------------- */
await expect("admin adds a person to the roster", true, () => setDoc(doc(admin, `orgs/${A}/people/a-new`), { id: "a-new", name: "New", email: "new@a.test", kind: "staff", active: true }));
await expect("admin grants that person membership", true, () => setDoc(doc(admin, `orgs/${A}/members/new@a.test`), { personId: "a-new", kind: "staff", active: true }));
await expect("admin files that person's index entry", true, () => setDoc(doc(admin, "userIndex/new@a.test"), { orgId: A, personId: "a-new" }));
await expect("admin promotes a colleague to admin", true, () => updateDoc(doc(admin, `orgs/${A}/members/bo@a.test`), { kind: "manager" }));
await expect("admin demotes them again", true, () => updateDoc(doc(admin, `orgs/${A}/members/bo@a.test`), { kind: "staff" }));
await expect("admin deactivates a member", true, () => updateDoc(doc(admin, `orgs/${A}/members/cy@a.test`), { active: false }));
await expect("the deactivated member is locked out at once", false, () => getDocs(collection(cy, `orgs/${A}/shifts`)));
await expect("admin reactivates them", true, () => updateDoc(doc(admin, `orgs/${A}/members/cy@a.test`), { active: true }));
await expect("staff edits a colleague's roster record", false, () => updateDoc(doc(ann, `orgs/${A}/people/a-bo`), { phone: "000" }));
await expect("supervisor edits the roster", false, () => updateDoc(doc(sup, `orgs/${A}/people/a-bo`), { phone: "000" }));

/* ------------------------------- the schedule ------------------------------- */
await expect("staff reads the schedule", true, () => getDocs(collection(ann, `orgs/${A}/shifts`)));
await expect("staff posts their own shift to colleagues", true, () => updateDoc(doc(ann, `orgs/${A}/shifts/s-ann`), { posted: true }));
await expect("staff reassigns their own shift to someone else", false, () => updateDoc(doc(ann, `orgs/${A}/shifts/s-ann`), { personId: "a-bo" }));
await expect("staff takes a colleague's shift by writing their own name on it", false, () => updateDoc(doc(ann, `orgs/${A}/shifts/s-bo`), { personId: "a-ann" }));
await expect("staff un-posts a colleague's shift", false, () => updateDoc(doc(ann, `orgs/${A}/shifts/s-bo`), { posted: false }));
await expect("staff creates a shift", false, () => setDoc(doc(ann, `orgs/${A}/shifts/s-x`), { id: "s-x", personId: "a-ann" }));
await expect("staff deletes a shift", false, () => deleteDoc(doc(ann, `orgs/${A}/shifts/s-ann`)));
await expect("supervisor reassigns a shift", true, () => updateDoc(doc(sup, `orgs/${A}/shifts/s-ann`), { personId: "a-cy" }));
await expect("supervisor puts it back", true, () => updateDoc(doc(sup, `orgs/${A}/shifts/s-ann`), { personId: "a-ann", posted: false }));
await expect("admin publishes a generated shift", true, () => setDoc(doc(admin, `orgs/${A}/shifts/s-gen`), { id: "s-gen", date: "2026-12-03", role: "OR RN", personId: "a-cy", posted: false, outSick: false }));

/* --------------------------------- requests --------------------------------- */
await expect("staff offers up their own shift", true, () => setDoc(doc(ann, `orgs/${A}/requests/r-new`), { id: "r-new", type: "post", shiftId: "s-ann", fromId: "a-ann", toId: null, coworker: "pending", status: "submitted" }));
await expect("staff offers up a colleague's shift in the colleague's name", false, () => setDoc(doc(ann, `orgs/${A}/requests/r-forged`), { id: "r-forged", type: "post", shiftId: "s-bo", fromId: "a-bo", toId: null, coworker: "pending", status: "submitted" }));
await expect("staff files a request that is already approved", false, () => setDoc(doc(ann, `orgs/${A}/requests/r-pre`), { id: "r-pre", type: "post", shiftId: "s-ann", fromId: "a-ann", toId: null, coworker: "agreed", status: "approved" }));
await expect("a colleague picks up an open post", true, () => updateDoc(doc(cy, `orgs/${A}/requests/r-open`), { type: "pickup", toId: "a-cy", coworker: "agreed" }));
await expect("the named co-worker confirms a trade", true, () => updateDoc(doc(bo, `orgs/${A}/requests/r-trade`), { coworker: "agreed" }));
await expect("the named co-worker approves it themselves", false, () => updateDoc(doc(bo, `orgs/${A}/requests/r-trade`), { status: "approved" }));
await expect("the requester approves their own request", false, () => updateDoc(doc(ann, `orgs/${A}/requests/r-trade`), { status: "approved" }));
await expect("an uninvolved colleague answers someone else's trade", false, () => updateDoc(doc(cy, `orgs/${A}/requests/r-trade`), { coworker: "agreed" }));
await expect("the requester retracts", true, () => updateDoc(doc(ann, `orgs/${A}/requests/r-new`), { status: "retracted" }));
await expect("management approves", true, () => updateDoc(doc(admin, `orgs/${A}/requests/r-trade`), { status: "approved" }));
await expect("anyone deletes request history", false, () => deleteDoc(doc(admin, `orgs/${A}/requests/r-trade`)));

/* --------------------------------- time off --------------------------------- */
await expect("staff marks their own day off", true, () => setDoc(doc(ann, `orgs/${A}/timeOff/a-ann_2026-12-09`), { personId: "a-ann", date: "2026-12-09" }));
await expect("staff marks a colleague's day off", false, () => setDoc(doc(ann, `orgs/${A}/timeOff/a-bo_2026-12-09`), { personId: "a-bo", date: "2026-12-09" }));
await expect("a day off carrying a reason", false, () => setDoc(doc(ann, `orgs/${A}/timeOff/a-ann_2026-12-10`), { personId: "a-ann", date: "2026-12-10", reason: "surgery" }));
await expect("staff clears a colleague's day off", false, () => deleteDoc(doc(bo, `orgs/${A}/timeOff/a-ann_2026-12-05`)));
await expect("staff clears their own day off", true, () => deleteDoc(doc(ann, `orgs/${A}/timeOff/a-ann_2026-12-05`)));
await expect("the scheduler reads everyone's days off", true, () => getDocs(collection(admin, `orgs/${A}/timeOff`)));

/* --------------------------------- messages --------------------------------- */
const msgs = (db, field, id) => getDocs(query(collection(db, `orgs/${A}/messages`), where(field, "==", id)));
await expect("sender reads what they sent", true, () => msgs(ann, "fromId", "a-ann"));
await expect("recipient reads what they were sent", true, () => msgs(bo, "toId", "a-bo"));
await expect("a third colleague reads a conversation they are not in", false, () => getDoc(doc(cy, `orgs/${A}/messages/m1`)));
await expect("admin reads an unreported conversation", false, () => getDoc(doc(admin, `orgs/${A}/messages/m1`)));
await expect("admin lists every message", false, () => getDocs(collection(admin, `orgs/${A}/messages`)));
await expect("admin reads reported messages", true, () => msgs(admin, "reported", true));
await expect("supervisor reads reported messages", false, () => msgs(sup, "reported", true));
await expect("staff sends a message as themselves", true, () => setDoc(doc(ann, `orgs/${A}/messages/m3`), { id: "m3", fromId: "a-ann", toId: "a-cy", body: "swap?", at: "x", readAt: null, reported: false }));
await expect("staff sends a message in a colleague's name", false, () => setDoc(doc(ann, `orgs/${A}/messages/m4`), { id: "m4", fromId: "a-bo", toId: "a-cy", body: "forged", at: "x", readAt: null, reported: false }));
await expect("a message over 500 characters", false, () => setDoc(doc(ann, `orgs/${A}/messages/m5`), { id: "m5", fromId: "a-ann", toId: "a-cy", body: "x".repeat(501), at: "x", readAt: null, reported: false }));
await expect("recipient marks a message read", true, () => updateDoc(doc(bo, `orgs/${A}/messages/m1`), { readAt: "now" }));
await expect("recipient reports a message", true, () => updateDoc(doc(bo, `orgs/${A}/messages/m1`), { reported: true }));
await expect("recipient rewrites what was said", false, () => updateDoc(doc(bo, `orgs/${A}/messages/m1`), { body: "I never asked" }));
await expect("sender edits a sent message", false, () => updateDoc(doc(ann, `orgs/${A}/messages/m1`), { body: "edited" }));
await expect("admin deletes a reported message", true, () => deleteDoc(doc(admin, `orgs/${A}/messages/m2`)));
await expect("admin deletes an unreported message", false, () => deleteDoc(doc(admin, `orgs/${A}/messages/m3`)));
await expect("sender deletes their own message", true, () => deleteDoc(doc(ann, `orgs/${A}/messages/m3`)));

/* ------------------------------ call settings ------------------------------ */
const tpl = { id: "call", roles: ["OR RN"], slots: [{ id: "0", role: "OR RN", kind: "first", time: "1900-0700" }], depts: {}, callButton: { desktop: true, mobile: true, who: "everyone" } };
await expect("admin saves the call template", true, () => setDoc(doc(admin, `orgs/${A}/settings/call`), tpl));
await expect("staff reads the call template", true, () => getDoc(doc(ann, `orgs/${A}/settings/call`)));
await expect("staff edits the call template", false, () => setDoc(doc(ann, `orgs/${A}/settings/call`), { ...tpl, roles: [] }));
await expect("supervisor edits the call template", false, () => setDoc(doc(sup, `orgs/${A}/settings/call`), tpl));
await expect("another tenant's admin edits this tenant's template", false, () => setDoc(doc(otherAdmin, `orgs/${A}/settings/call`), tpl));
await expect("another tenant's admin reads this tenant's template", false, () => getDoc(doc(otherAdmin, `orgs/${A}/settings/call`)));
await expect("admin writes a settings record under another name", false, () => setDoc(doc(admin, `orgs/${A}/settings/billing`), tpl));
await expect("a template with no slot list", false, () => setDoc(doc(admin, `orgs/${A}/settings/call`), { id: "call", roles: ["OR RN"] }));
await expect("admin deletes the call template", false, () => deleteDoc(doc(admin, `orgs/${A}/settings/call`)));
await expect("admin still cannot edit the organization record itself", false, () => updateDoc(doc(admin, `orgs/${A}`), { name: "Renamed" }));

/* ---------------------------- department managers ---------------------------- */
/* dm runs Endo only. ann is OR staff, eve is Endo staff. */
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, `orgs/${A}/settings/call`), { ...tpl, roles: ["OR RN", "Endo RN"], depts: { "OR RN": "OR", "Endo RN": "Endo" } });
  await setDoc(doc(db, `orgs/${A}/people/a-dm`), { id: "a-dm", name: "dm", email: "dm@a.test", role: "Endo Manager", kind: "manager", depts: ["Endo"], active: true });
  await setDoc(doc(db, `orgs/${A}/members/dm@a.test`), { personId: "a-dm", kind: "manager", depts: ["Endo"], active: true });
  await setDoc(doc(db, `orgs/${A}/people/a-eve`), { id: "a-eve", name: "eve", email: "eve@a.test", role: "Endo RN", kind: "staff", active: true });
  await setDoc(doc(db, `orgs/${A}/members/eve@a.test`), { personId: "a-eve", kind: "staff", active: true });
  await setDoc(doc(db, `orgs/${A}/people/a-ann`), { id: "a-ann", name: "ann", email: "ann@a.test", role: "OR RN", kind: "staff", active: true });
  await setDoc(doc(db, `orgs/${A}/shifts/s-endo`), { id: "s-endo", date: "2026-12-04", role: "Endo RN", personId: "a-eve", posted: false, outSick: false });
  await setDoc(doc(db, `orgs/${A}/shifts/s-or`), { id: "s-or", date: "2026-12-04", role: "OR RN", personId: "a-ann", posted: false, outSick: false });
  await setDoc(doc(db, `orgs/${A}/requests/r-endo`), { id: "r-endo", type: "trade", shiftId: "s-endo", fromId: "a-eve", toId: "a-ann", coworker: "agreed", status: "submitted" });
  await setDoc(doc(db, `orgs/${A}/requests/r-or`), { id: "r-or", type: "trade", shiftId: "s-or", fromId: "a-ann", toId: "a-bo", coworker: "agreed", status: "submitted" });
});
const dm = env.authenticatedContext("dm", { email: "dm@a.test", email_verified: true }).firestore();
const endoShift = (id) => ({ id, date: "2026-12-06", role: "Endo RN", personId: "a-eve", posted: false, outSick: false });
await expect("department manager reads the whole schedule", true, () => getDocs(collection(dm, `orgs/${A}/shifts`)));
await expect("department manager reassigns a shift in their department", true, () => updateDoc(doc(dm, `orgs/${A}/shifts/s-endo`), { outSick: true }));
await expect("department manager reassigns a shift in another department", false, () => updateDoc(doc(dm, `orgs/${A}/shifts/s-or`), { personId: "a-eve" }));
await expect("department manager publishes a shift for their department", true, () => setDoc(doc(dm, `orgs/${A}/shifts/s-endo2`), endoShift("s-endo2")));
await expect("department manager publishes a shift for another department", false, () => setDoc(doc(dm, `orgs/${A}/shifts/s-or2`), { ...endoShift("s-or2"), role: "OR RN" }));
await expect("department manager relabels their shift into another department", false, () => updateDoc(doc(dm, `orgs/${A}/shifts/s-endo`), { role: "OR RN" }));
await expect("department manager deletes another department's shift", false, () => deleteDoc(doc(dm, `orgs/${A}/shifts/s-or`)));
await expect("department manager deletes their own department's shift", true, () => deleteDoc(doc(dm, `orgs/${A}/shifts/s-endo2`)));
await expect("department manager approves a request in their department", true, () => updateDoc(doc(dm, `orgs/${A}/requests/r-endo`), { status: "approved" }));
await expect("department manager approves a request in another department", false, () => updateDoc(doc(dm, `orgs/${A}/requests/r-or`), { status: "approved" }));
await expect("department manager posts another department's shift to staff", false, () => setDoc(doc(dm, `orgs/${A}/requests/r-dm`), { id: "r-dm", type: "post", shiftId: "s-or", fromId: "a-ann", toId: null, coworker: "pending", status: "submitted" }));
await expect("department manager edits the call template", false, () => setDoc(doc(dm, `orgs/${A}/settings/call`), tpl));
await expect("department manager edits their own staff", true, () => updateDoc(doc(dm, `orgs/${A}/people/a-eve`), { phone: "555-0199" }));
await expect("department manager edits another department's staff", false, () => updateDoc(doc(dm, `orgs/${A}/people/a-ann`), { phone: "555-0199" }));
await expect("department manager moves another department's staff into theirs", false, () => updateDoc(doc(dm, `orgs/${A}/people/a-ann`), { role: "Endo RN" }));
await expect("department manager moves their staff into another department", false, () => updateDoc(doc(dm, `orgs/${A}/people/a-eve`), { role: "OR RN" }));
await expect("department manager edits a supervisor", false, () => updateDoc(doc(dm, `orgs/${A}/people/a-sup`), { phone: "x" }));
await expect("department manager adds staff to their department", true, () => setDoc(doc(dm, `orgs/${A}/people/a-fay`), { id: "a-fay", name: "fay", email: "fay@a.test", role: "Endo RN", kind: "staff", active: true }));
await expect("department manager lets that person in", true, () => setDoc(doc(dm, `orgs/${A}/members/fay@a.test`), { personId: "a-fay", kind: "staff", active: true }));
await expect("department manager adds staff to another department", false, () => setDoc(doc(dm, `orgs/${A}/people/a-gus`), { id: "a-gus", name: "gus", email: "gus@a.test", role: "OR RN", kind: "staff", active: true }));
await expect("department manager adds a roster record marked admin", false, () => setDoc(doc(dm, `orgs/${A}/people/a-hal`), { id: "a-hal", name: "hal", email: "hal@a.test", role: "Endo RN", kind: "manager", active: true }));
await expect("department manager grants admin access", false, () => setDoc(doc(dm, `orgs/${A}/members/hal@a.test`), { personId: "a-fay", kind: "manager", active: true }));
await expect("department manager promotes their own staff", false, () => updateDoc(doc(dm, `orgs/${A}/members/eve@a.test`), { kind: "supervisor" }));
await expect("department manager gives their staff a department to run", false, () => updateDoc(doc(dm, `orgs/${A}/members/eve@a.test`), { depts: ["Endo"] }));
await expect("department manager widens their own departments", false, () => updateDoc(doc(dm, `orgs/${A}/members/dm@a.test`), { depts: [] }));
await expect("department manager deactivates their own staff", true, () => updateDoc(doc(dm, `orgs/${A}/members/eve@a.test`), { active: false }));
await expect("department manager deactivates another department's staff", false, () => updateDoc(doc(dm, `orgs/${A}/members/ann@a.test`), { active: false }));
await expect("department manager demotes the admin", false, () => updateDoc(doc(dm, `orgs/${A}/members/admin@a.test`), { kind: "staff" }));
await expect("department manager removes a member", false, () => deleteDoc(doc(dm, `orgs/${A}/members/ann@a.test`)));
await expect("admin makes someone a department manager", true, () => updateDoc(doc(admin, `orgs/${A}/members/bo@a.test`), { kind: "manager", depts: ["OR"] }));
await expect("admin still edits any department's shift", true, () => updateDoc(doc(admin, `orgs/${A}/shifts/s-or`), { outSick: true }));

/* --------------------------------- operator --------------------------------- */
await expect("operator creates an organization", true, () => setDoc(doc(owner, "orgs/valley"), { name: "Valley Medical" }));
await expect("operator seats its first admin", true, () => setDoc(doc(owner, "orgs/valley/members/first@valley.test"), { personId: "v-1", kind: "manager", active: true }));
await expect("operator files that admin's index entry", true, () => setDoc(doc(owner, "userIndex/first@valley.test"), { orgId: "valley", personId: "v-1" }));
await expect("operator reads a tenant's roster", false, () => getDocs(collection(owner, `orgs/${A}/people`)));
await expect("a visitor files a request to join", true, () => setDoc(doc(anon, "joinRequests/j1"), { org: "Some Hospital", email: "x@y.test" }));
await expect("a visitor reads who else asked to join", false, () => getDocs(collection(anon, "joinRequests")));
await expect("an unnamed collection is closed", false, () => setDoc(doc(admin, "anything/else"), { a: 1 }));

await env.cleanup();
console.log(`\n${count - failed}/${count} passed`);
process.exit(failed ? 1 : 0);
