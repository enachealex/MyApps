/**
 * The Firestore side of persistence.
 *
 * The app keeps one in-memory object per tenant — { people, shifts, requests,
 * timeOff, messages } — and every screen edits it through setDb. Rather than
 * teach three thousand lines of screens about documents and collections, this
 * module keeps that object true in both directions:
 *
 *   subscribeOrg   listens to the tenant's collections and hands back a whole
 *                  fresh object whenever anything changes, from anyone.
 *   pushChanges    is given the object before and after a local edit, works
 *                  out which documents differ, and writes just those.
 *
 * So the screens are the same code in the local demo and against Firestore;
 * only where the object comes from, and where edits go, differs.
 *
 * Layout (see firestore.rules for who may touch what):
 *
 *   userIndex/{email}                  -> { orgId, personId }
 *   orgs/{org}                         the tenant's configuration
 *   orgs/{org}/members/{email}         -> { personId, kind, active }
 *   orgs/{org}/people|shifts|requests|timeOff|messages/{id}
 */
import { ensureCloud } from "./firebase";

const COLLECTIONS = ["people", "shifts", "requests", "timeOff", "messages"];

/* Time off has no id of its own; a person can only be off once per day. */
const keyFor = (name, item) => (name === "timeOff" ? `${item.personId}_${item.date}` : item.id);

/* Firestore rejects `undefined`, and the screens produce it freely. */
const clean = (o) => JSON.parse(JSON.stringify(o));

export async function findMembership(email) {
  const cloud = await ensureCloud();
  const snap = await cloud.fs.getDoc(cloud.fs.doc(cloud.db, "userIndex", email));
  return snap.exists() ? snap.data() : null;
}

export async function isOperator(email) {
  const cloud = await ensureCloud();
  try {
    return (await cloud.fs.getDoc(cloud.fs.doc(cloud.db, "operators", email))).exists();
  } catch (e) {
    return false;
  }
}

export async function loadOrg(orgId) {
  const cloud = await ensureCloud();
  const snap = await cloud.fs.getDoc(cloud.fs.doc(cloud.db, "orgs", orgId));
  return snap.exists() ? { ...snap.data(), id: orgId } : null;
}

/**
 * Listens to everything this person may read in their tenant. `onData` is not
 * called until every collection has answered once, so the app never renders a
 * schedule with the roster still missing. Returns an unsubscribe function.
 */
export async function subscribeOrg({ orgId, personId, isManager }, onData, onError) {
  const cloud = await ensureCloud();
  const { fs, db } = cloud;
  const col = (name) => fs.collection(db, "orgs", orgId, name);

  const state = { people: null, shifts: null, requests: null, timeOff: null };
  /* Messages are three queries because the rules only let you read your own
     conversations (plus reported ones, for an Admin) — a plain read of the
     collection is refused outright. */
  const messageParts = { sent: null, received: null, reported: isManager ? null : [] };

  let scheduled = false;
  const emit = () => {
    if (scheduled) return;
    scheduled = true;
    Promise.resolve().then(() => {
      scheduled = false;
      if (Object.values(state).some((v) => v === null) || Object.values(messageParts).some((v) => v === null)) return;
      const byId = new Map();
      [...messageParts.sent, ...messageParts.received, ...messageParts.reported].forEach((m) => byId.set(m.id, m));
      onData({ org: orgId, ...state, messages: [...byId.values()].sort((a, b) => String(a.at).localeCompare(String(b.at))) });
    });
  };

  const listen = (source, assign) =>
    fs.onSnapshot(
      source,
      (snap) => {
        assign(snap.docs.map((d) => d.data()));
        emit();
      },
      (err) => onError(err)
    );

  const stops = [
    ...Object.keys(state).map((name) => listen(col(name), (rows) => (state[name] = rows))),
    listen(fs.query(col("messages"), fs.where("fromId", "==", personId)), (rows) => (messageParts.sent = rows)),
    listen(fs.query(col("messages"), fs.where("toId", "==", personId)), (rows) => (messageParts.received = rows)),
  ];
  if (isManager) {
    stops.push(listen(fs.query(col("messages"), fs.where("reported", "==", true)), (rows) => (messageParts.reported = rows)));
  }

  return () => stops.forEach((stop) => stop());
}

function diff(name, before = [], after = []) {
  const prev = new Map(before.map((x) => [keyFor(name, x), x]));
  const next = new Map(after.map((x) => [keyFor(name, x), x]));
  const sets = [];
  const dels = [];
  next.forEach((item, id) => {
    const old = prev.get(id);
    if (!old || JSON.stringify(old) !== JSON.stringify(item)) sets.push([id, item, old]);
  });
  prev.forEach((item, id) => {
    if (!next.has(id)) dels.push([id, item]);
  });
  return { sets, dels };
}

/**
 * Writes whatever differs between two versions of the tenant object. Resolves
 * to the number of documents written; rejects if the server refuses, in which
 * case nothing in that batch was applied.
 */
export async function pushChanges(orgId, before, after) {
  const cloud = await ensureCloud();
  const { fs, db } = cloud;
  const ops = [];
  const at = (...segments) => fs.doc(db, ...segments);

  COLLECTIONS.forEach((name) => {
    const { sets, dels } = diff(name, before[name], after[name]);
    sets.forEach(([id, item, old]) => {
      ops.push((b) => b.set(at("orgs", orgId, name, id), clean(item)));
      if (name !== "people") return;

      /* A roster entry is also what lets someone in. Their membership and
         their index entry are kept beside it, keyed by email, because that is
         all the rules know about a person when they sign in. */
      const email = (item.email || "").trim().toLowerCase();
      const oldEmail = old ? (old.email || "").trim().toLowerCase() : "";
      if (oldEmail && oldEmail !== email) {
        ops.push((b) => b.delete(at("orgs", orgId, "members", oldEmail)));
        ops.push((b) => b.delete(at("userIndex", oldEmail)));
      }
      if (email) {
        ops.push((b) => b.set(at("orgs", orgId, "members", email), { personId: item.id, kind: item.kind || "staff", active: item.active !== false }));
        ops.push((b) => b.set(at("userIndex", email), { orgId, personId: item.id }));
      }
    });
    dels.forEach(([id, item]) => {
      ops.push((b) => b.delete(at("orgs", orgId, name, id)));
      const email = name === "people" ? (item.email || "").trim().toLowerCase() : "";
      if (email) {
        ops.push((b) => b.delete(at("orgs", orgId, "members", email)));
        ops.push((b) => b.delete(at("userIndex", email)));
      }
    });
  });

  /* A batch is all-or-nothing and capped at 500 writes. A published rotation
     is a few hundred, so chunk rather than assume it fits. */
  for (let i = 0; i < ops.length; i += 400) {
    const batch = fs.writeBatch(db);
    ops.slice(i, i + 400).forEach((op) => op(batch));
    await batch.commit();
  }
  return ops.length;
}

/* Your own membership entry: what access level the rules will hold you to. */
export async function loadMember(orgId, email) {
  const cloud = await ensureCloud();
  const snap = await cloud.fs.getDoc(cloud.fs.doc(cloud.db, "orgs", orgId, "members", email));
  return snap.exists() ? snap.data() : null;
}
