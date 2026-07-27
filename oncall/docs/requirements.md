# OnCall — agreed requirements

Decisions captured from the customer conversation, so they survive between
working sessions. Update this when a decision changes; it is the reference,
not the chat history.

Status legend: **TODO** not started · **WIP** in progress · **DONE** shipped

---

## 1. Admin-controlled display settings — TODO

Per organization, editable by admins only (`kind === "manager"`). Stored
alongside the org's other data so each tenant sets its own.

### 1a. Check-in visibility

A single toggle hides every trace of check-in from the UI.

The `checkIn` field stays on the shift record either way — only the UI is
gated, so switching the toggle back on does not lose history.

Places that must respect it:

| Where | What is shown today |
| --- | --- |
| `TodayView` header | "6/12 checked in" count |
| `TodayView` my-shift card | "Checked in HH:MM" pill, "Check in" button, explainer line |
| `CallRow` | "Checked in HH:MM" / "Not checked in" pill |
| `ManageView` | "Checked in HH:MM" pill |
| `ShiftSheet` | "Check in" / "Checked in HH:MM" button |
| `checkIn()` in `Shell` | "Checked in. The supervisor can see you're reachable." toast |

### 1b. Call button

Three independent controls:

1. **Enabled on desktop** — on/off
2. **Enabled on mobile** — on/off
3. **Who may tap it** — everyone, or supervisors and admins only

Rules:

- Desktop and mobile are set separately. Platform is decided by pointer type
  (`canDial`), not viewport width, so a narrow desktop window is still desktop.
- Where the button is **disabled for the platform**, or the viewer is **not
  permitted to tap**, the number still shows as **plain selectable text**.
  Never hide the number — staff must be able to read it off and dial manually.
- Where the button is enabled and permitted, current behavior stands: `tel:`
  on a real dialer, copy-to-clipboard with a toast where there is none.

---

## 2. Authentication — TODO, blocked on backend

Current state: `attempt()` in `OnCallApp.jsx` checks the username exists and
the password box is non-empty, then signs in. **Any password works.** There is
no auth to harden, only auth to build.

### Requirements

- Organizations cannot self-register. Adding an org is a request by email to
  the site owner.
- Owner account: username `admin_aenache`, the owner's email, initial password
  `admin1234`.
- Every user's first sign-in with a temp password forces a password change.
- All other users get a **randomized** temp password.
- Username and temp password **must be emailed** to the user.

### Why this needs a server

The app is a static site; `storage.js` writes to `localStorage` in each
visitor's browser. Therefore:

- Any hardcoded password ships inside the public JS bundle. It is readable
  with a single `curl` of `/oncall/assets/index-*.js`.
- A browser-generated temp password lives only on the visitor's own machine.
  There is nothing to verify it against and nowhere to store a hash.
- A browser cannot send email; a mail API key cannot live in client code for
  the same reason as above.

This carries real weight here: the roster holds named hospital staff, personal
mobile numbers, and shift locations.

### Agreed approach

**Cloudflare Workers + D1**, matching the DNS and CDN already in use, with
Resend or Postmark for credential email. Password hashing server-side
(Argon2id or bcrypt); temp passwords generated server-side, single-use, and
expiring.

The two seams to replace are already isolated: `storage.js` for persistence
and `attempt()` for identity.

**Until that backend exists, no real staff data goes on the public URL.**

---

## 3. UI alignment with customer visuals — TODO

Screenshots and videos live in a Google Drive folder shared by the owner. They
had not been readable from a working session yet — the connector was not bound
and the folder requires sign-in. Reconcile the UI against them once available.
