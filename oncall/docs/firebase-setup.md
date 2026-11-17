# Going live: real accounts and a shared database

OnCall ships in **local mode**: no backend, everything in each browser's own
storage, and any password accepted. That is the demo. Adding one Firebase
config to the build turns it into the live app — real accounts, one database
shared by everyone in an organization, and security rules deciding who sees
what. Leaving the config out changes nothing, so the demo keeps working.

Everything below has been run end to end against Firebase's local emulators.
None of it has yet been run against a real Firebase project.

## What happens for the people using it

- **You (the operator)** create each organization and name its first Admin,
  with a script on your own machine.
- **An Admin** adds their staff on the People screen, by work email.
- **Each person** opens the site, chooses *First time here? Set up your
  account*, picks their own password, and follows a single-use link sent to
  their email. Until they follow it they can see nothing. Nobody is ever sent
  a password.
- An address that is on no roster reaches a screen that says so and gives your
  email. Organizations cannot sign themselves up.

## 1. Create the Firebase project

1. <https://console.firebase.google.com> → **Add project**. Any name; Google
   Analytics is not needed.
2. **Build → Authentication → Get started → Email/Password → Enable → Save.**
   Leave "Email link (passwordless sign-in)" off.
3. **Build → Firestore Database → Create database → Production mode.** Choose
   a US region; it cannot be changed later.

## 2. Give the build its config

**Project settings** (the gear) **→ General → Your apps → Web `</>`**. Register
the app. Firebase shows a block like this:

```js
const firebaseConfig = {
  apiKey: "AIzaSyD-example-key-1234567890",
  authDomain: "oncall-12345.firebaseapp.com",
  projectId: "oncall-12345",
  storageBucket: "oncall-12345.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc123def456"
};
```

In GitHub: the **MyApps** repo → **Settings → Secrets and variables → Actions →
New repository secret**.

- **Name:** `FIREBASE_CONFIG`
- **Secret:** that object as JSON — every key in quotes, no `const`, no
  semicolon, no trailing comma:

```json
{
  "apiKey": "AIzaSyD-example-key-1234567890",
  "authDomain": "oncall-12345.firebaseapp.com",
  "projectId": "oncall-12345",
  "storageBucket": "oncall-12345.firebasestorage.app",
  "messagingSenderId": "123456789012",
  "appId": "1:123456789012:web:abc123def456"
}
```

Then add the site's address under **Authentication → Settings → Authorized
domains**: `myapps.thejumpvault.com`.

**How to tell it worked:** after the next deploy the first screen says "Sign in
with your work email" and offers *First time here?*. If it still asks only for
an email and shows no password box, the build is in local mode — check the
secret's name and that the JSON is valid. Bad JSON is reported in the browser
console and the site falls back to the demo rather than breaking.

This config is not a secret in the security sense; it is published in the
site's JavaScript by design. The rules in the next step are what protect the
data.

**Adding this secret replaces the demo on the public site.** The three sample
hospitals only exist in local mode. If the client is still reviewing them, hold
off, or import one into the real database with step 4.

## 3. Deploy the security rules

```bash
npm install -g firebase-tools
```

```bash
firebase login
```

```bash
firebase deploy --only firestore:rules --project <your-project-id>
```

Run these from the `oncall` folder. The rules are in `firestore.rules`.

## 4. Create an organization

The Admin SDK is not installed by default:

```bash
npm install --no-save firebase-admin
```

Download a service-account key: **Project settings → Service accounts →
Generate new private key**. Keep the file outside the repository. Anyone holding
it can read and change everything.

Point the tool at it (Windows PowerShell):

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\key.json"
```

Make yourself an operator:

```bash
node scripts/operator.mjs add-operator you@example.com
```

Create the organization from a JSON file (the format is at the top of
`scripts/operator.mjs`):

```bash
node scripts/operator.mjs create-org valley.json
```

Or load one of the sample hospitals, people included, to try the live app
before a real customer exists:

```bash
node scripts/operator.mjs import-demo aurelia
```

`import-demo valley` loads the 40-person Valley Medical sample instead.

The tool refuses to overwrite an organization that already exists.
`list-orgs` shows what is there.

A new organization has no shifts. Its Admin signs in, opens **Call Management**
and uses **Generate rotation** to fill the first block.

## How access is decided

| Document | Holds | Written by |
| --- | --- | --- |
| `operators/{email}` | who runs the platform | nobody from the app; the operator tool only |
| `userIndex/{email}` | which organization an address belongs to | that organization's Admin, or the operator |
| `orgs/{org}` | name, colours, roles, call template | the operator |
| `orgs/{org}/members/{email}` | roster id, access level, departments managed, active or not | that organization's Admin (never their own entry); a department manager, for their own staff only |
| `orgs/{org}/settings/call` | the Admin's edits to the call template and phone buttons | that organization's Admin |
| `orgs/{org}/people`, `shifts`, `requests`, `timeOff`, `messages` | the working data | see `firestore.rules` |

Access is keyed on email and counts only once Firebase has **verified** that
email. Without that, someone could register a colleague's address before the
colleague did and inherit their place on the roster.

Because "operator" is a separate collection no client can write, there is no
value an Admin can put anywhere that promotes them above their own
organization. Deactivating someone on the People screen locks them out
immediately.

## Checking it yourself

```bash
npm run test:rules
```

Runs 124 cases against a local Firestore emulator — who may read and write what,
weighted towards the refusals. Needs Java 11 or newer; the script pins an older
Firebase CLI because the newest one requires Java 21.

```bash
npm run test:rotation
```

Checks the rotation generator.

```bash
npm run test:template
```

Checks the call-template editing logic.

## Not done yet

- **On Windows the emulator can outlive a test run.** `npm run test:rules`
  sometimes leaves its Java process holding port 8787, and the next run then
  fails with "port taken". End the `java.exe` listening on 8787 and run again.

- **Never run against a real Firebase project.** The emulator is faithful for
  rules and data, but real email delivery, the authorized-domain setting and
  Firebase's sign-in limits have not been exercised.
- **Verification emails use Firebase's default wording and sender.** They can
  be reworded under Authentication → Templates.
- **Usernames no longer sign anyone in on the live build**, only emails. There
  is no organization to look a username up in before someone has signed in.
- **"Continue with Microsoft" on the old sign-in screen is not wired up.** The
  live sign-in screen does not show it.
- **App Check is off.** Turn it on (console → App Check → reCAPTCHA v3) before
  real staff data, so only the real site can talk to the database.
- **No backups configured.** Firestore's scheduled backups are a console
  setting.
- **Usage and cost have not been measured.** Every screen load reads the whole
  roster and schedule for the organization; fine for tens of people, worth
  measuring before hundreds.
- **A lawyer's read** on the messaging guard-rails and the terms of use is
  still outstanding, as before.
