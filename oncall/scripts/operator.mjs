/**
 * Operator tool — the things only the platform owner does, which is why they
 * are a script on the owner's machine and not a screen in the app.
 *
 *   node scripts/operator.mjs add-operator you@example.com
 *   node scripts/operator.mjs create-org org.json
 *   node scripts/operator.mjs import-demo aurelia
 *   node scripts/operator.mjs list-orgs
 *
 * It uses the Admin SDK, which is not a project dependency:
 *
 *   npm install --no-save firebase-admin
 *
 * Against a real project, point it at a service-account key (Firebase console
 * → Project settings → Service accounts → Generate new private key). Keep that
 * file out of the repository; it is the keys to everything.
 *
 *   set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\key.json     (Windows)
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json    (macOS, Linux)
 *
 * Against the local emulators no key is needed:
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8787 GCLOUD_PROJECT=demo-oncall node scripts/operator.mjs ...
 *
 * create-org takes a JSON file shaped like this (roles, slots and depts are
 * the call template; `admin` is the first person, who can then add the rest
 * from the People screen):
 *
 *   {
 *     "id": "valley",
 *     "name": "Valley Medical Center",
 *     "unit": "Perioperative Services",
 *     "city": "Renton, WA",
 *     "brand": "#1F6FB2",
 *     "roles": ["OR RN", "Scrub Tech"],
 *     "slots": [{ "role": "OR RN", "kind": "first", "time": "1900-0700" }],
 *     "depts": { "OR RN": "Operating Room", "Scrub Tech": "Operating Room" },
 *     "admin": { "name": "Pat Example", "email": "pat@valley.example", "role": "Nurse Manager", "phone": "(425) 555-0100" }
 *   }
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const [command, arg] = process.argv.slice(2);

const { initializeApp, applicationDefault } = await import("firebase-admin/app").catch(() => {
  console.error("firebase-admin is not installed. Run:  npm install --no-save firebase-admin");
  process.exit(1);
});
const { getFirestore } = await import("firebase-admin/firestore");

const emulated = !!process.env.FIRESTORE_EMULATOR_HOST;
initializeApp(emulated ? { projectId: process.env.GCLOUD_PROJECT || "demo-oncall" } : { credential: applicationDefault() });
const db = getFirestore();

const lower = (s) => String(s || "").trim().toLowerCase();

/* Brand tints the app expects alongside the brand colour. */
function tints(brand) {
  const n = parseInt(brand.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const mix = (t, k) => "#" + [r, g, b].map((c) => Math.round(c + (t - c) * k).toString(16).padStart(2, "0")).join("");
  return { brand, deep: mix(0, 0.25), link: mix(0, 0.15), soft: mix(255, 0.88), chip: mix(255, 0.9) };
}

async function writePerson(batch, orgId, person) {
  const email = lower(person.email);
  batch.set(db.doc(`orgs/${orgId}/people/${person.id}`), { ...person, email });
  if (email) {
    batch.set(db.doc(`orgs/${orgId}/members/${email}`), { personId: person.id, kind: person.kind || "staff", active: person.active !== false });
    batch.set(db.doc(`userIndex/${email}`), { orgId, personId: person.id });
  }
}

async function createOrg(config, people) {
  const { admin, roster, ...rest } = config;
  const org = { roles: [], slots: [], depts: {}, aliases: {}, ...tints(rest.brand || "#5B5FC7"), ...rest };
  delete org.people;
  if (!org.id || !org.name) throw new Error("An organization needs an id and a name.");
  if ((await db.doc(`orgs/${org.id}`).get()).exists) throw new Error(`Organization "${org.id}" already exists. Nothing was changed.`);

  const batch = db.batch();
  batch.set(db.doc(`orgs/${org.id}`), org);
  for (const p of people) await writePerson(batch, org.id, p);
  await batch.commit();
  console.log(`Created ${org.name} (${org.id}) with ${people.length} ${people.length === 1 ? "person" : "people"}.`);
  people.filter((p) => p.kind === "manager").forEach((p) => console.log(`  Admin: ${p.name} <${p.email}> — they set up their own account from the sign-in screen.`));
}

/* The seeded demo tenants live in the app source. Pull them out of it rather
   than keep a second copy that would drift. */
function demoOrgs() {
  const src = readFileSync(join(here, "..", "src", "OnCallApp.jsx"), "utf8").replace(/\r\n/g, "\n");
  const cut = (a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));
  const code = [cut("function suggestUsername", "function buildOrg"), cut("function buildOrg", "const ORGS = ["), cut("const ORGS = [", "const getOrg"), "return ORGS;"].join("\n");
  return new Function(code)();
}

const commands = {
  async "add-operator"(email) {
    if (!email) throw new Error("Give the operator's email address.");
    await db.doc(`operators/${lower(email)}`).set({ since: new Date().toISOString() });
    console.log(`${lower(email)} is now an operator.`);
  },

  async "create-org"(file) {
    if (!file) throw new Error("Give the path to an organization JSON file.");
    const config = JSON.parse(readFileSync(file, "utf8"));
    if (!config.admin || !config.admin.email) throw new Error("The file needs an `admin` with at least a name and an email.");
    const first = { id: `${config.id}-u01`, role: "Manager", phone: "", alt: "", username: lower(config.admin.email).split("@")[0], active: true, ...config.admin, kind: "manager" };
    await createOrg(config, [first]);
  },

  async "import-demo"(id) {
    const org = demoOrgs().find((o) => o.id === id);
    if (!org) throw new Error(`No demo organization "${id}". Try: ${demoOrgs().map((o) => o.id).join(", ")}`);
    await createOrg(org, org.people);
  },

  async "list-orgs"() {
    const snap = await db.collection("orgs").get();
    if (snap.empty) console.log("No organizations yet.");
    for (const d of snap.docs) {
      const members = await db.collection(`orgs/${d.id}/members`).count().get();
      console.log(`${d.id.padEnd(16)} ${String(d.data().name).padEnd(36)} ${members.data().count} members`);
    }
  },
};

if (!commands[command]) {
  console.error(`Usage: node scripts/operator.mjs <${Object.keys(commands).join(" | ")}> [argument]`);
  process.exit(1);
}

try {
  await commands[command](arg);
} catch (e) {
  console.error(`Failed: ${e.message}`);
  process.exit(1);
}
