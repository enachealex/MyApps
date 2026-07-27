import React, { useState, useEffect, useMemo, useRef, useContext, createContext } from "react";
import {
  Home,
  CalendarDays,
  Users,
  Phone,
  History,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  X,
  Search,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  Send,
  ShieldCheck,
  Mail,
  Undo2,
  ClipboardList,
  UserCheck,
  UserPlus,
  Copy,
  Printer,
  Filter,
  Building2,
  LogOut,
  Lock,
  KeyRound,
  Eye,
  EyeOff,
  ArrowLeft,
  Repeat,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";

/* ==================================================================
 * OnCall Schedule — multi-organization mobile app
 *
 * Flow: pick organization -> sign in -> the app, scoped to that org.
 * Every org carries its own roles, call template, departments, roster,
 * brand color, and sign-in method. Schedule and request data are stored
 * under a per-org key, so nothing crosses tenants.
 *
 * To add an organization, add one entry to ORGS. No other file changes.
 * ================================================================== */

/* Neutral tokens shared by every tenant. `C` is mutated by applyTheme and read
   during render, so a theme change plus a re-render repaints the whole app
   without threading a palette through every component. */
const LIGHT = {
  ink: "#1B1B1F",
  sub: "#61616B",
  faint: "#8A8A94",
  line: "#E3E3EA",
  bg: "#F4F4F8",
  surface: "#FFFFFF",
  surfaceAlt: "#EAEAF0",
  note: "#F5F5FA",
  neutralBg: "#EFEFF4",
  okBg: "#E7F4E7",
  okBorder: "#BFE3BF",
  warnBg: "#FCEEE2",
  warnBorder: "#E6C9A8",
  dangerBg: "#FBE9EB",
  chevron: "#B6B6C2",
  disabledBg: "#EDEDF2",
  disabledFg: "#A2A2AC",
  toastBg: "#26262F",
  stepIdle: "#D8D8E2",
  stepIdleBorder: "#C9C9D4",
  navIdle: "#8A8A94",
  amber: "#9A5A00",
  neutralBtn: "#3F3F4B",
  warn: "#C4520A",
  danger: "#B02A37",
  ok: "#107C10",
};

const DARK = {
  ink: "#ECECF1",
  sub: "#A6A6B4",
  faint: "#85858F",
  line: "#32323C",
  bg: "#131317",
  surface: "#1D1D24",
  surfaceAlt: "#24242C",
  note: "#23232B",
  neutralBg: "#2A2A33",
  okBg: "#16301B",
  okBorder: "#2E6B34",
  warnBg: "#332410",
  warnBorder: "#7A5320",
  dangerBg: "#351A1E",
  chevron: "#6A6A78",
  disabledBg: "#2A2A33",
  disabledFg: "#6A6A78",
  toastBg: "#3A3A46",
  stepIdle: "#3A3A46",
  stepIdleBorder: "#4A4A58",
  navIdle: "#8A8A99",
  amber: "#B8760A",
  neutralBtn: "#4A4A58",
  warn: "#E5934F",
  danger: "#F0808E",
  ok: "#5CBE60",
};

const C = { ...LIGHT };

function applyTheme(dark) {
  Object.assign(C, dark ? DARK : LIGHT);
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }
}

/* Tailwind's bg-white is a class, so it needs a CSS override rather than a
   token. Native controls follow color-scheme above. */
const THEME_CSS = `
[data-theme="dark"] .bg-white { background-color: ${DARK.surface} !important; }
[data-theme="dark"] input,
[data-theme="dark"] textarea,
[data-theme="dark"] select {
  background-color: ${DARK.surface};
  color: ${DARK.ink};
}
[data-theme="dark"] input::placeholder,
[data-theme="dark"] textarea::placeholder { color: #6E6E7C; }
`;

/* brand tints: light mode uses the org's pale wash, dark mode needs the brand
   floated on a dark surface instead */
function hexToRgb(hex) {
  const h = String(hex).replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}
const rgba = (hex, a) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};
const mixWithWhite = (hex, amount) => {
  const [r, g, b] = hexToRgb(hex);
  const m = (c) => Math.round(c + (255 - c) * amount);
  return `rgb(${m(r)}, ${m(g)}, ${m(b)})`;
};
function themedOrg(org, dark) {
  if (!org || !dark) return org;
  return {
    ...org,
    soft: rgba(org.brand, 0.26),
    chip: rgba(org.brand, 0.2),
    deep: mixWithWhite(org.brand, 0.55),
    link: mixWithWhite(org.brand, 0.45),
  };
}

/* semantic shift colors — consistent across tenants */
const KIND = {
  first: { label: "1st Call", bg: "#5C2E91", fg: "#FFFFFF" },
  second: { label: "2nd Call", bg: "#107C10", fg: "#FFFFFF" },
  work: { label: "Work Shift", bg: "#F0AD00", fg: "#2A1F00" },
};

/* ------------------------- tenant registry ------------------------- */
/* Usernames are what people sign in with. Suggested from the name, but the
   admin owns them: first initial + last name, deduped inside the org. */
function suggestUsername(name, taken) {
  const parts = name.toLowerCase().replace(/[^a-z ]/g, "").split(" ").filter(Boolean);
  const base = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1]}` : parts[0] || "user";
  let candidate = base;
  let n = 1;
  const lower = taken.map((t) => String(t).toLowerCase());
  while (lower.includes(candidate)) {
    n += 1;
    candidate = `${base}${n}`;
  }
  return candidate;
}

function buildOrg(cfg) {
  const taken = [];
  const people = cfg.roster.map((r, i) => {
    const [name, role, phone, alt, kind] = r;
    const slug = name.toLowerCase().replace(/[^a-z ]/g, "").split(" ").filter(Boolean).join(".");
    const username = suggestUsername(name, taken);
    taken.push(username);
    return {
      id: `${cfg.id}-u${String(i + 1).padStart(2, "0")}`,
      name,
      role,
      phone,
      alt: alt || "",
      kind: kind || "staff",
      username,
      email: `${slug}@${cfg.domain}`,
      active: true,
    };
  });
  return { ...cfg, people };
}

const ORGS = [
  buildOrg({
    id: "aurelia",
    name: "Saint Aurelia Medical Center",
    unit: "Surgical Services",
    city: "Tacoma, WA",
    code: "AURELIA",
    domain: "staurelia.org",
    sso: "Microsoft Entra ID",
    brand: "#5B5FC7",
    deep: "#4448A0",
    link: "#4F52B2",
    soft: "#EDEDF9",
    chip: "#EDEDF6",
    aliases: { "Anes MD Backup": "Anes MD" },
    roles: ["Anes MD", "Anes MD Backup", "Anes Tech", "CRNA", "Endo RN", "Endo Tech", "OR RN", "OR Scrub Tech", "PACU RN"],
    depts: {
      "Anes MD": "7021 - Anesthesia",
      "Anes MD Backup": "7021 - Anesthesia",
      "Anes Tech": "7021 - Anesthesia",
      CRNA: "7021 - Anesthesia",
      "Endo RN": "7022 - Endoscopy",
      "Endo Tech": "7022 - Endoscopy",
      "OR RN": "7020 - Surgical Services",
      "OR Scrub Tech": "7020 - Surgical Services",
      "PACU RN": "7023 - PACU",
    },
    slots: [
      { role: "Anes MD", kind: "work", time: "0700-1900" },
      { role: "Anes MD Backup", kind: "first", time: "1900-0700" },
      { role: "Anes Tech", kind: "work", time: "2300-0730" },
      { role: "Anes Tech", kind: "first", time: "2100-0700" },
      { role: "CRNA", kind: "first", time: "1900-0700" },
      { role: "Endo RN", kind: "first", time: "1730-0630" },
      { role: "Endo RN", kind: "second", time: "1730-2030" },
      { role: "Endo Tech", kind: "first", time: "1730-0630" },
      { role: "OR RN", kind: "first", time: "2100-0700" },
      { role: "OR RN", kind: "second", time: "2300-0700" },
      { role: "OR Scrub Tech", kind: "first", time: "2100-0700" },
      { role: "PACU RN", kind: "first", time: "2300-0700" },
    ],
    roster: [
      ["Denise Park", "Surgical Services Manager", "(206) 555-0001", "", "manager"],
      ["Gale Rios", "House Supervisor", "(206) 555-0000", "", "supervisor"],
      ["Jin Park", "Anes MD", "(216) 555-0112"],
      ["Anthony Trask", "Anes MD", "(206) 555-6136", "(206) 555-5411"],
      ["Nadia Haddad", "Anes MD", "(253) 555-9002"],
      ["Nakia Dowd", "Anes Tech", "(253) 555-4487"],
      ["Haroun Rajas", "Anes Tech", "(360) 555-0350"],
      ["Carlos Longo", "Anes Tech", "(206) 555-7741", "(206) 555-2210"],
      ["Andre Nicolet", "Anes Tech", "(425) 555-3390"],
      ["Andrew Dessel", "CRNA", "(919) 555-7754"],
      ["Kayla Jensen", "CRNA", "(253) 555-1188"],
      ["Colin Frey", "CRNA", "(206) 555-4023"],
      ["Ruby Karan", "Endo RN", "(253) 555-2382"],
      ["Anne Shaughn", "Endo RN", "(206) 555-0498"],
      ["Hue Doan", "Endo RN", "(425) 555-6612"],
      ["Mishell Roy", "Endo Tech", "(253) 555-5465"],
      ["Jill Kanoa", "Endo Tech", "(808) 555-2277"],
      ["James Roland", "Endo Tech", "(360) 555-9931"],
      ["Caitlin Barker", "OR RN", "(818) 555-6530"],
      ["Sherry Duan", "OR RN", "(206) 555-3145"],
      ["Sarah Skinner", "OR RN", "(253) 555-9216"],
      ["Priya Nair", "OR RN", "(425) 555-7708", "(425) 555-1180"],
      ["Marisa Boyd", "OR Scrub Tech", "(206) 555-8890"],
      ["Melissa Gitch", "OR Scrub Tech", "(253) 555-4471"],
      ["Alek White", "OR Scrub Tech", "(360) 555-2098"],
      ["Agnes Mucek", "OR Scrub Tech", "(206) 555-6634"],
      ["Johanna Abaya", "PACU RN", "(206) 555-1902"],
      ["Leia Goodman", "PACU RN", "(253) 555-8123"],
      ["Dennis Irabo", "PACU RN", "(310) 555-9494", "(425) 555-7269"],
    ],
  }),
  buildOrg({
    id: "cascade",
    name: "Cascade Valley Regional",
    unit: "Perioperative Services",
    city: "Everett, WA",
    code: "CASCADE",
    domain: "cascadevalley.health",
    sso: "Microsoft Entra ID",
    brand: "#0F6C74",
    deep: "#0A5157",
    link: "#0E6068",
    soft: "#E3F1F2",
    chip: "#E8F3F4",
    aliases: {},
    roles: ["Anes MD", "CRNA", "OR RN", "OR Tech", "CVOR RN", "SPD Tech", "PACU RN"],
    depts: {
      "Anes MD": "3120 - Anesthesia",
      CRNA: "3120 - Anesthesia",
      "OR RN": "3100 - Perioperative",
      "OR Tech": "3100 - Perioperative",
      "CVOR RN": "3105 - Cardiovascular OR",
      "SPD Tech": "3140 - Sterile Processing",
      "PACU RN": "3160 - PACU",
    },
    slots: [
      { role: "Anes MD", kind: "work", time: "0700-1900" },
      { role: "Anes MD", kind: "first", time: "1900-0700" },
      { role: "CRNA", kind: "first", time: "1900-0700" },
      { role: "OR RN", kind: "first", time: "1500-2300" },
      { role: "OR RN", kind: "second", time: "2300-0700" },
      { role: "OR Tech", kind: "first", time: "1900-0700" },
      { role: "CVOR RN", kind: "first", time: "1900-0700" },
      { role: "SPD Tech", kind: "first", time: "2300-0700" },
      { role: "PACU RN", kind: "first", time: "1900-0700" },
    ],
    roster: [
      ["Yolanda Reese", "Perioperative Director", "(425) 555-2000", "", "manager"],
      ["Tom Bergquist", "Nursing Supervisor", "(425) 555-2001", "", "supervisor"],
      ["Aditi Raman", "Anes MD", "(425) 555-3311"],
      ["Owen McHale", "Anes MD", "(206) 555-3312"],
      ["Bea Fontaine", "CRNA", "(360) 555-3320"],
      ["Nate Okonkwo", "CRNA", "(425) 555-3321"],
      ["Steph Ruiz", "OR RN", "(425) 555-3330", "(425) 555-9930"],
      ["Danielle Fu", "OR RN", "(206) 555-3331"],
      ["Marcus Bell", "OR RN", "(360) 555-3332"],
      ["Ivy Sandoval", "OR Tech", "(425) 555-3340"],
      ["Peter Lindqvist", "OR Tech", "(206) 555-3341"],
      ["Rochelle Amari", "CVOR RN", "(425) 555-3350"],
      ["Grant Whitfield", "CVOR RN", "(360) 555-3351"],
      ["Tuan Vo", "SPD Tech", "(425) 555-3360"],
      ["Kelsey Braun", "SPD Tech", "(206) 555-3361"],
      ["Lorna Estrada", "PACU RN", "(425) 555-3370"],
      ["Chad Emerson", "PACU RN", "(360) 555-3371"],
    ],
  }),
  buildOrg({
    id: "northgate",
    name: "Northgate Surgery Center",
    unit: "Ambulatory Surgery",
    city: "Seattle, WA",
    code: "NORTHGATE",
    domain: "northgatesc.com",
    sso: null,
    brand: "#A23B2E",
    deep: "#7E2C22",
    link: "#96382C",
    soft: "#FAEBE8",
    chip: "#FBEEEB",
    aliases: {},
    roles: ["Anes MD", "OR RN", "Scrub Tech", "PACU RN"],
    depts: {
      "Anes MD": "Anesthesia",
      "OR RN": "Main OR",
      "Scrub Tech": "Main OR",
      "PACU RN": "Recovery",
    },
    slots: [
      { role: "Anes MD", kind: "first", time: "1600-0700" },
      { role: "OR RN", kind: "first", time: "1600-0700" },
      { role: "Scrub Tech", kind: "first", time: "1600-0700" },
      { role: "PACU RN", kind: "first", time: "1600-0700" },
    ],
    roster: [
      ["Renata Silva", "Center Administrator", "(206) 555-4000", "", "manager"],
      ["Paul Osei", "Charge Nurse", "(206) 555-4001", "", "supervisor"],
      ["Hannah Wexler", "Anes MD", "(206) 555-4110"],
      ["Sofia Marchetti", "Anes MD", "(425) 555-4111"],
      ["Derek Cho", "OR RN", "(206) 555-4120"],
      ["Amara Bello", "OR RN", "(253) 555-4121"],
      ["Ken Tallman", "Scrub Tech", "(206) 555-4130"],
      ["Bridget Nolan", "Scrub Tech", "(360) 555-4131"],
      ["Omar Haddadi", "PACU RN", "(206) 555-4140"],
      ["Tess Kilbride", "PACU RN", "(425) 555-4141"],
    ],
  }),
];

const getOrg = (id) => ORGS.find((o) => o.id === id) || null;
const user = (org, id) => (org ? org.people.find((p) => p.id === id) || null : null);
const staffInRole = (org, role) => {
  const src = (org.aliases && org.aliases[role]) || role;
  return org.people.filter((p) => p.kind === "staff" && (p.role === role || p.role === src));
};

/* ------------------------------ dates ------------------------------ */
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
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_L = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON_S = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longDate = (k) => {
  const d = fromKey(k);
  return `${DOW_L[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};
const shortDate = (k) => {
  const d = fromKey(k);
  return `${DOW[d.getDay()]}, ${MON_S[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};
const stamp = (iso) => {
  const d = new Date(iso);
  return `${MON_S[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
};
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/* --------------------------- seeded data --------------------------- */
const HORIZON = 60;

function seed(org) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const shifts = [];
  for (let i = -2; i < HORIZON; i++) {
    const d = addDays(today, i);
    const k = keyOf(d);
    org.slots.forEach((slot, si) => {
      const pool = staffInRole(org, slot.role);
      if (!pool.length) return;
      const person = pool[Math.abs(i + si * 3 + 40) % pool.length];
      shifts.push({
        id: `${k}~${si}`,
        date: k,
        role: slot.role,
        kind: slot.kind,
        time: slot.time,
        personId: person.id,
        posted: false,
        outSick: false,
        checkIn: null,
      });
    });
  }

  const requests = [];
  const now = Date.now();
  const pick = (dayOffset, idx) => shifts.find((s) => s.date === keyOf(addDays(today, dayOffset)) && s.id.endsWith(`~${idx}`));
  const other = (org, shift) => {
    const pool = staffInRole(org, shift.role).filter((p) => p.id !== shift.personId);
    return pool.length ? pool[0] : null;
  };
  const lastSlot = org.slots.length - 1;

  const a = pick(6, Math.min(2, lastSlot));
  if (a) {
    a.posted = true;
    requests.push({
      id: "r1",
      type: "post",
      shiftId: a.id,
      fromId: a.personId,
      toId: null,
      coworker: "pending",
      status: "submitted",
      submittedAt: new Date(now - 26 * 3600e3).toISOString(),
      respondedAt: null,
      notes: "Family event — happy to cover a weekend back.",
      partial: false,
      email: false,
      kronos: false,
    });
  }

  const b = pick(9, Math.min(1, lastSlot));
  const bTo = b ? other(org, b) : null;
  if (b && bTo) {
    requests.push({
      id: "r2",
      type: "trade",
      shiftId: b.id,
      fromId: b.personId,
      toId: bTo.id,
      coworker: "pending",
      status: "submitted",
      submittedAt: new Date(now - 5 * 3600e3).toISOString(),
      respondedAt: null,
      notes: "Can you take this one? I'll owe you a Saturday.",
      partial: false,
      email: false,
      kronos: false,
    });
  }

  const c = pick(4, Math.min(3, lastSlot));
  const cTo = c ? other(org, c) : null;
  if (c && cTo) {
    requests.push({
      id: "r3",
      type: "trade",
      shiftId: c.id,
      fromId: c.personId,
      toId: cTo.id,
      coworker: "agreed",
      status: "submitted",
      submittedAt: new Date(now - 50 * 3600e3).toISOString(),
      respondedAt: new Date(now - 44 * 3600e3).toISOString(),
      notes: "",
      partial: false,
      email: false,
      kronos: false,
    });
  }

  const d2 = pick(11, 0);
  const dTo = d2 ? other(org, d2) : null;
  if (d2 && dTo) {
    d2.posted = true;
    requests.push({
      id: "r4",
      type: "pickup",
      shiftId: d2.id,
      fromId: d2.personId,
      toId: dTo.id,
      coworker: "agreed",
      status: "submitted",
      submittedAt: new Date(now - 9 * 3600e3).toISOString(),
      respondedAt: new Date(now - 9 * 3600e3).toISOString(),
      notes: "",
      partial: false,
      email: false,
      kronos: false,
    });
  }

  const e = pick(2, lastSlot);
  const eFrom = e ? other(org, e) : null;
  if (e && eFrom) {
    requests.push({
      id: "r5",
      type: "post",
      shiftId: e.id,
      fromId: eFrom.id,
      toId: e.personId,
      coworker: "agreed",
      status: "approved",
      submittedAt: new Date(now - 120 * 3600e3).toISOString(),
      respondedAt: new Date(now - 118 * 3600e3).toISOString(),
      notes: "",
      partial: false,
      email: true,
      kronos: true,
    });
  }

  const tonight = keyOf(today);
  shifts
    .filter((s) => s.date === tonight)
    .slice(0, Math.max(1, Math.floor(org.slots.length / 2)))
    .forEach((s, i) => {
      s.checkIn = { at: new Date(now - (30 + i * 12) * 60e3).toISOString(), reachable: true };
    });
  const sick = shifts.find((s) => s.date === tonight && s.id.endsWith("~2"));
  if (sick) sick.outSick = true;

  return {
    org: org.id,
    seedDate: tonight,
    people: org.people.map((p) => ({ ...p })),
    shifts,
    requests,
  };
}

/* --------------------------- viewport ------------------------------ */
/* Layout switches on JS rather than breakpoint classes so the same file
   behaves identically in a bundled build and in a preview sandbox. */
function useIsDesktop(min = 768) {
  const query = `(min-width: ${min}px)`;
  const [wide, setWide] = useState(() => {
    try {
      return window.matchMedia(query).matches;
    } catch (e) {
      return false;
    }
  });
  useEffect(() => {
    let mq;
    try {
      mq = window.matchMedia(query);
    } catch (e) {
      return undefined;
    }
    const onChange = (e) => setWide(e.matches);
    setWide(mq.matches);
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, [query]);
  return wide;
}

/* Theme: "system" follows the OS, and keeps following it if the OS flips. */
function useThemeMode() {
  const [mode, setMode] = useState("system");
  const [systemDark, setSystemDark] = useState(() => {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch (e) {
      return false;
    }
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mq;
    try {
      mq = window.matchMedia("(prefers-color-scheme: dark)");
    } catch (e) {
      return undefined;
    }
    const onChange = (e) => setSystemDark(e.matches);
    setSystemDark(mq.matches);
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await window.storage.get("oncall_theme_v1");
        if (alive && res && ["light", "dark", "system"].includes(res.value)) setMode(res.value);
      } catch (e) {
        /* no saved preference — stay on system */
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        await window.storage.set("oncall_theme_v1", mode);
      } catch (e) {
        /* session only */
      }
    })();
  }, [mode, loaded]);

  const dark = mode === "dark" || (mode === "system" && systemDark);
  applyTheme(dark);
  return { mode, setMode, dark };
}

/* Supervisors still post a paper list on the board. */
const PRINT_CSS = `
@media print {
  .oncall-no-print { display: none !important; }
  .oncall-window { border: none !important; box-shadow: none !important; height: auto !important; max-width: none !important; margin: 0 !important; border-radius: 0 !important; overflow: visible !important; }
  .oncall-scroll { overflow: visible !important; height: auto !important; }
  body { background: #fff !important; }
}
`;

/* ------------------------------ context ---------------------------- */
const AppCtx = createContext({ org: ORGS[0], say: () => {} });
const useOrg = () => useContext(AppCtx).org;
const useSay = () => useContext(AppCtx).say || (() => {});
/* Sticky offset: on a phone the brand header floats above the content at 56px;
   inside the desktop card the header scrolls with it, so the offset is 0. */
const useStickyTop = () => (useContext(AppCtx).desktop ? 0 : 56);

/* ------------------------------ tiny UI ---------------------------- */
function Badge({ kind }) {
  const k = KIND[kind];
  return (
    <span
      className="inline-flex items-center justify-center rounded px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: k.bg, color: k.fg, minWidth: 72 }}
    >
      {k.label}
    </span>
  );
}

function Pill({ text, color, bg, icon: Icon }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ color, backgroundColor: bg }}>
      {Icon ? <Icon size={12} /> : null}
      {text}
    </span>
  );
}

/* Bottom sheet on a phone, centered dialog on a desktop. */
function Sheet({ open, onClose, title, children }) {
  const desktop = useIsDesktop();
  if (!open) return null;
  return (
    <div
      className={`oncall-no-print fixed inset-0 z-50 flex justify-center ${desktop ? "items-center p-6" : "items-end"}`}
      style={{ backgroundColor: "rgba(20,20,28,0.55)" }}
      onClick={onClose}
    >
      <div
        className={`w-full bg-white shadow-xl ${desktop ? "max-w-lg rounded-2xl" : "max-w-md rounded-t-2xl"}`}
        style={{ maxHeight: desktop ? "86vh" : "92vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`sticky top-0 flex items-center justify-between border-b bg-white px-4 py-3 ${desktop ? "rounded-t-2xl" : "rounded-t-2xl"}`}
          style={{ borderColor: C.line }}
        >
          <div className="text-base font-semibold" style={{ color: C.ink }}>{title}</div>
          <button onClick={onClose} className="rounded p-1" aria-label="Close" style={{ color: C.sub }}>
            <X size={20} />
          </button>
        </div>
        <div className="px-4 pt-3" style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}>{children}</div>
      </div>
    </div>
  );
}

function Btn({ children, onClick, tone = "primary", disabled, full, size = "md", icon: Icon, brand }) {
  const org = useOrg();
  const b = brand || (org ? org.brand : "#5B5FC7");
  const tones = {
    primary: { backgroundColor: b, color: "#fff", border: `1px solid ${b}` },
    ghost: { backgroundColor: C.surface, color: C.ink, border: `1px solid ${C.line}` },
    green: { backgroundColor: C.ok, color: "#fff", border: `1px solid ${C.ok}` },
    amber: { backgroundColor: C.amber, color: "#fff", border: `1px solid ${C.amber}` },
    danger: { backgroundColor: C.surface, color: C.danger, border: `1px solid ${C.danger}` },
  };
  const s = disabled ? { backgroundColor: C.disabledBg, color: C.disabledFg, border: `1px solid ${C.disabledBg}` } : tones[tone];
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-semibold ${size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2.5 text-sm"} ${full ? "w-full" : ""}`}
      style={s}
    >
      {Icon ? <Icon size={size === "sm" ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

function Stepper({ step }) {
  const org = useOrg();
  const labels = ["Post shift to staff", "Co-worker accepted", "Approved"];
  return (
    <div className="flex items-start justify-between px-1 py-3">
      {labels.map((l, i) => (
        <React.Fragment key={l}>
          <div className="flex flex-col items-center" style={{ width: 92 }}>
            <div
              className="flex h-6 w-6 items-center justify-center rounded-full"
              style={{ backgroundColor: i <= step ? org.brand : "#fff", border: `2px solid ${i <= step ? org.brand : C.stepIdleBorder}`, color: "#fff" }}
            >
              {i <= step ? <Check size={14} /> : null}
            </div>
            <div className="mt-1 text-center text-xs leading-tight" style={{ color: i <= step ? org.link : C.faint }}>{l}</div>
          </div>
          {i < 2 ? <div className="mt-3 h-0.5 flex-1" style={{ backgroundColor: i < step ? org.brand : C.stepIdle }} /> : null}
        </React.Fragment>
      ))}
    </div>
  );
}

function Empty({ icon: Icon, title, hint }) {
  return (
    <div className="flex flex-col items-center px-8 py-14 text-center">
      <Icon size={28} style={{ color: C.chevron }} />
      <div className="mt-3 text-sm font-semibold" style={{ color: C.ink }}>{title}</div>
      {hint ? <div className="mt-1 text-xs" style={{ color: C.sub }}>{hint}</div> : null}
    </div>
  );
}

function OrgTile({ org, size = 44 }) {
  const initials = org.name
    .replace(/[^A-Za-z ]/g, "")
    .split(" ")
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-xl font-bold text-white"
      style={{ backgroundColor: org.brand, width: size, height: size, fontSize: size / 2.8 }}
    >
      {initials}
    </div>
  );
}

/* ============================== ROOT ============================== */
export default function OnCallApp() {
  const { mode: themeMode, setMode: setThemeMode, dark } = useThemeMode();
  const [booted, setBooted] = useState(false);
  const [orgId, setOrgId] = useState(null);
  const [userId, setUserId] = useState(null);
  const [db, setDb] = useState(null);
  const [dbOrg, setDbOrg] = useState(null);

  /* restore session */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await window.storage.get("oncall_session_v2");
        if (alive && res && res.value) {
          const s = JSON.parse(res.value);
          if (s.orgId && getOrg(s.orgId)) {
            setOrgId(s.orgId);
            if (s.userId && user(getOrg(s.orgId), s.userId)) setUserId(s.userId);
          }
        }
      } catch (e) {
        /* no saved session */
      } finally {
        if (alive) setBooted(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!booted) return;
    (async () => {
      try {
        await window.storage.set("oncall_session_v2", JSON.stringify({ orgId, userId }));
      } catch (e) {
        /* session stays in memory */
      }
    })();
  }, [orgId, userId, booted]);

  /* load this tenant's schedule, isolated per org key */
  useEffect(() => {
    let alive = true;
    if (!orgId) {
      setDb(null);
      setDbOrg(null);
      return;
    }
    const org = getOrg(orgId);
    (async () => {
      let next = null;
      try {
        const res = await window.storage.get(`oncall_db_${orgId}_v2`);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          if (parsed && parsed.org === orgId && parsed.seedDate === keyOf(new Date()) && Array.isArray(parsed.people)) next = parsed;
        }
      } catch (e) {
        /* seed fresh below */
      }
      if (!next) next = seed(org);
      if (alive) {
        setDb(next);
        setDbOrg(orgId);
      }
    })();
    return () => {
      alive = false;
    };
  }, [orgId]);

  useEffect(() => {
    if (!db || !orgId || dbOrg !== orgId) return;
    (async () => {
      try {
        await window.storage.set(`oncall_db_${orgId}_v2`, JSON.stringify(db));
      } catch (e) {
        /* in-memory only */
      }
    })();
  }, [db, orgId, dbOrg]);

  const baseOrg = getOrg(orgId);
  /* the roster lives in tenant data, so the live org reads people from db */
  const org = themedOrg(baseOrg && db && dbOrg === orgId ? { ...baseOrg, people: db.people } : baseOrg, dark);

  if (!booted) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center" style={{ backgroundColor: C.bg }}>
        <div className="text-sm" style={{ color: C.sub }}>Loading…</div>
      </div>
    );
  }

  if (!org)
    return (
      <>
        <style>{THEME_CSS}</style>
        <OrgPicker onPick={(id) => setOrgId(id)} />
      </>
    );

  if (!db || dbOrg !== orgId) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center" style={{ backgroundColor: C.bg }}>
        <div className="text-sm" style={{ color: C.sub }}>Loading {org.name}…</div>
      </div>
    );
  }

  if (!userId || !user(org, userId)) {
    return (
      <AppCtx.Provider value={{ org }}>
        <style>{THEME_CSS}</style>
        <SignIn org={org} onBack={() => setOrgId(null)} onSignIn={(id) => setUserId(id)} />
      </AppCtx.Provider>
    );
  }

  return (
    <AppCtx.Provider value={{ org }}>
      <Shell
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        org={org}
        db={db}
        setDb={setDb}
        viewerId={userId}
        setViewerId={setUserId}
        onSignOut={() => setUserId(null)}
        onSwitchOrg={() => {
          setUserId(null);
          setOrgId(null);
        }}
      />
    </AppCtx.Provider>
  );
}

/* =========================== ORG PICKER =========================== */
function OrgPicker({ onPick }) {
  const [q, setQ] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");

  const list = ORGS.filter(
    (o) => q.trim() === "" || o.name.toLowerCase().includes(q.toLowerCase()) || o.city.toLowerCase().includes(q.toLowerCase())
  );

  const submitCode = () => {
    const match = ORGS.find((o) => o.code.toLowerCase() === code.trim().toLowerCase());
    if (match) onPick(match.id);
    else setCodeError("No organization uses that code. Check with your scheduler.");
  };

  return (
    <div className="mx-auto min-h-screen w-full max-w-md" style={{ backgroundColor: C.bg, fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif', color: C.ink }}>
      <div className="px-5 pb-4" style={{ paddingTop: "calc(3rem + env(safe-area-inset-top))" }}>
        <div className="text-2xl font-bold">OnCall Schedule</div>
        <div className="mt-1 text-sm" style={{ color: C.sub }}>Choose your organization to continue.</div>
      </div>

      <div className="px-5">
        <div className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2.5" style={{ borderColor: C.line }}>
          <Search size={16} style={{ color: C.faint }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search hospitals and surgery centers"
            className="w-full text-sm outline-none"
          />
        </div>
      </div>

      <div className="mt-3 px-5">
        {list.length === 0 ? (
          <Empty icon={Building2} title="No match" hint="Try the organization code your scheduler gave you." />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-white" style={{ borderColor: C.line }}>
            {list.map((o, i) => (
              <button
                key={o.id}
                onClick={() => onPick(o.id)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left"
                style={{ borderTop: i ? `1px solid ${C.line}` : "none" }}
              >
                <OrgTile org={o} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{o.name}</div>
                  <div className="text-xs" style={{ color: C.sub }}>
                    {o.unit} · {o.city}
                  </div>
                </div>
                <ChevronRight size={18} style={{ color: C.chevron }} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 px-5 pb-10">
        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.faint }}>Not listed?</div>
        <div className="mt-2 flex gap-2">
          <input
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setCodeError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitCode();
              }
            }}
            enterKeyHint="go"
            placeholder="Organization code"
            className="min-w-0 flex-1 rounded-md border bg-white px-3 py-2.5 text-sm outline-none"
            style={{ borderColor: codeError ? C.danger : C.line }}
          />
          <Btn brand={C.neutralBtn} onClick={submitCode} icon={KeyRound}>
            Continue
          </Btn>
        </div>
        {codeError ? (
          <div className="mt-1.5 flex items-center gap-1 text-xs" style={{ color: C.danger }}>
            <AlertCircle size={12} /> {codeError}
          </div>
        ) : null}
        <div className="mt-2 text-xs" style={{ color: C.faint }}>Demo codes: AURELIA, CASCADE, NORTHGATE</div>
      </div>
    </div>
  );
}

/* ============================= SIGN IN ============================ */
function SignIn({ org, onBack, onSignIn }) {
  const [username, setUsername] = useState("");
  const [pw, setPw] = useState("");
  const pwRef = useRef(null);
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [pickList, setPickList] = useState(false);

  const attempt = () => {
    const entered = username.trim().toLowerCase();
    if (!entered) {
      setError("Enter your username.");
      return;
    }
    const found = org.people.find((p) => (p.username || "").toLowerCase() === entered);
    if (!found) {
      setError(`No account with that username at ${org.name}. Your scheduler sets it up.`);
      return;
    }
    if (found.active === false) {
      setError("That account is inactive. Contact your scheduler.");
      return;
    }
    if (!pw) {
      setError("Enter your password.");
      return;
    }
    onSignIn(found.id);
  };

  const demoAccounts = [
    org.people.find((p) => p.kind === "manager"),
    org.people.find((p) => p.kind === "supervisor"),
    ...org.people.filter((p) => p.kind === "staff").slice(0, 3),
  ].filter(Boolean);

  return (
    <div className="mx-auto min-h-screen w-full max-w-md" style={{ backgroundColor: C.bg, fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif', color: C.ink }}>
      <div className="px-5 pb-5" style={{ paddingTop: "calc(2rem + env(safe-area-inset-top))", backgroundColor: org.brand }}>
        <button onClick={onBack} className="mb-4 flex items-center gap-1 text-xs font-medium text-white">
          <ArrowLeft size={14} /> All organizations
        </button>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-sm font-bold" style={{ color: org.deep }}>
            {org.name.replace(/[^A-Za-z ]/g, "").split(" ").filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]).join("")}
          </div>
          <div>
            <div className="text-base font-semibold text-white">{org.name}</div>
            <div className="text-xs" style={{ color: "rgba(255,255,255,0.8)" }}>
              {org.unit} · {org.city}
            </div>
          </div>
        </div>
      </div>

      <div className="px-5 pt-5">
        <div className="text-lg font-bold">Sign in</div>
        <div className="mt-1 text-sm" style={{ color: C.sub }}>Use the username your scheduler set up for you.</div>

        {org.sso ? (
          <>
            <div className="mt-4">
              <Btn full icon={Lock} onClick={() => setPickList(true)}>
                Continue with {org.sso}
              </Btn>
            </div>
            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1" style={{ backgroundColor: C.line }} />
              <span className="text-xs" style={{ color: C.faint }}>or</span>
              <div className="h-px flex-1" style={{ backgroundColor: C.line }} />
            </div>
          </>
        ) : (
          <div className="mt-4" />
        )}

        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs font-semibold" style={{ color: C.sub }}>Username</div>
            <input
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (pw) attempt();
                else if (pwRef.current) pwRef.current.focus();
              }}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              enterKeyHint="next"
              spellCheck={false}
              placeholder="mboyd"
              className="w-full rounded-md border bg-white px-3 py-2.5 text-sm outline-none"
              style={{ borderColor: error ? C.danger : C.line }}
            />
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold" style={{ color: C.sub }}>Password</div>
            <div className="flex items-center rounded-md border bg-white px-3" style={{ borderColor: error ? C.danger : C.line }}>
              <input
                ref={pwRef}
                value={pw}
                onChange={(e) => {
                  setPw(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    attempt();
                  }
                }}
                type={show ? "text" : "password"}
                autoComplete="current-password"
                enterKeyHint="go"
                placeholder="••••••••"
                className="w-full py-2.5 text-sm outline-none"
              />
              <button onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}>
                {show ? <EyeOff size={16} style={{ color: C.faint }} /> : <Eye size={16} style={{ color: C.faint }} />}
              </button>
            </div>
          </div>
          {error ? (
            <div className="flex items-center gap-1 text-xs" style={{ color: C.danger }}>
              <AlertCircle size={12} /> {error}
            </div>
          ) : null}
          <Btn full onClick={attempt}>
            Sign in
          </Btn>
        </div>

        <button onClick={() => setPickList((v) => !v)} className="mt-5 w-full text-center text-xs font-semibold" style={{ color: org.link }}>
          {pickList ? "Hide demo accounts" : "Show demo accounts"}
        </button>

        {pickList ? (
          <div className="mt-2 overflow-hidden rounded-xl border bg-white" style={{ borderColor: C.line }}>
            {demoAccounts.map((p, i) => (
              <button
                key={p.id}
                onClick={() => onSignIn(p.id)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left"
                style={{ borderTop: i ? `1px solid ${C.line}` : "none" }}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="truncate text-xs" style={{ color: C.sub }}>
                    {p.role} · <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{p.username}</span>
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: C.chevron }} />
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-6 pb-10 text-center text-xs" style={{ color: C.faint }}>
          Demo build. Any password works, and accounts are per organization.
        </div>
      </div>
    </div>
  );
}

/* ============================== SHELL ============================= */
function Shell({ org, db, setDb, viewerId, setViewerId, onSignOut, onSwitchOrg, themeMode, setThemeMode }) {
  const [tab, setTab] = useState("home");
  const [accountOpen, setAccountOpen] = useState(false);
  const [shiftSheet, setShiftSheet] = useState(null);
  const [approveSheet, setApproveSheet] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const viewer = user(org, viewerId);
  const isStaff = viewer.kind === "staff";
  const isMgr = viewer.kind === "manager";
  const isSup = viewer.kind === "supervisor";

  const say = (msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };

  const shiftById = (id) => db.shifts.find((s) => s.id === id);
  const openReqFor = (shiftId) => db.requests.find((r) => r.shiftId === shiftId && r.status === "submitted");
  const reqById = (id) => db.requests.find((r) => r.id === id);
  const patchShift = (id, patch) => setDb((d) => ({ ...d, shifts: d.shifts.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const patchReq = (id, patch) => setDb((d) => ({ ...d, requests: d.requests.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const addReq = (r) => setDb((d) => ({ ...d, requests: [...d.requests, r] }));
  const newId = () => `r${Math.random().toString(36).slice(2, 9)}`;

  function offerUp(shiftId, notes, partial) {
    const s = shiftById(shiftId);
    patchShift(shiftId, { posted: true });
    addReq({
      id: newId(),
      type: "post",
      shiftId,
      fromId: s.personId,
      toId: null,
      coworker: "pending",
      status: "submitted",
      submittedAt: new Date().toISOString(),
      respondedAt: null,
      notes,
      partial,
      email: false,
      kronos: false,
    });
    say("Posted to staff. It shows in Available Shifts.");
  }

  function tradeShift(shiftId, toId, notes, partial) {
    const s = shiftById(shiftId);
    addReq({
      id: newId(),
      type: "trade",
      shiftId,
      fromId: s.personId,
      toId,
      coworker: "pending",
      status: "submitted",
      submittedAt: new Date().toISOString(),
      respondedAt: null,
      notes,
      partial,
      email: false,
      kronos: false,
    });
    say(`Sent to ${user(org, toId).name}. Waiting on their confirmation.`);
  }

  function pickUp(shiftId) {
    const r = openReqFor(shiftId);
    if (!r) return;
    patchReq(r.id, { type: "pickup", toId: viewerId, coworker: "agreed", respondedAt: new Date().toISOString() });
    say("You confirmed the pickup. Sent to management for approval.");
  }

  function respondToOffer(reqId, answer) {
    const r = reqById(reqId);
    if (answer === "agreed") {
      patchReq(reqId, { coworker: "agreed", respondedAt: new Date().toISOString() });
      say("Confirmed. Sent to management for approval.");
    } else {
      patchReq(reqId, { coworker: "refused", status: "denied", respondedAt: new Date().toISOString() });
      if (r) patchShift(r.shiftId, { posted: false });
      say("Declined. The shift stays with them.");
    }
  }

  function retract(reqId) {
    const r = reqById(reqId);
    patchReq(reqId, { status: "retracted" });
    if (r) patchShift(r.shiftId, { posted: false });
    say("Request retracted.");
  }

  function decide(reqId, approved, flags) {
    const r = reqById(reqId);
    if (!r) return;
    patchReq(reqId, {
      status: approved ? "approved" : "denied",
      email: !!flags.email,
      kronos: !!flags.kronos,
      decidedAt: new Date().toISOString(),
    });
    patchShift(r.shiftId, approved ? { personId: r.toId, posted: false, checkIn: null } : { posted: false });
    setApproveSheet(null);
    say(approved ? `Approved. ${user(org, r.toId).name} now holds the shift.` : "Denied. The original staff member keeps the shift.");
  }

  /* ---- roster administration ---- */
  function savePerson(person) {
    const exists = db.people.some((p) => p.id === person.id);
    setDb((d) => ({
      ...d,
      people: exists ? d.people.map((p) => (p.id === person.id ? { ...p, ...person } : p)) : [...d.people, person],
    }));
    say(exists ? `Saved ${person.name}.` : `${person.name} added. Username: ${person.username}`);
  }

  function setPersonActive(id, active) {
    setDb((d) => ({ ...d, people: d.people.map((p) => (p.id === id ? { ...p, active } : p)) }));
    say(active ? "Account reactivated." : "Account deactivated. They can no longer sign in.");
  }

  const checkIn = (shiftId) => {
    patchShift(shiftId, { checkIn: { at: new Date().toISOString(), reachable: true } });
    say("Checked in. The supervisor can see you're reachable.");
  };
  const undoCheckIn = (shiftId) => patchShift(shiftId, { checkIn: null });
  const toggleSick = (shiftId) => patchShift(shiftId, { outSick: !shiftById(shiftId).outSick });
  const reassign = (shiftId, personId) => {
    patchShift(shiftId, { personId, checkIn: null });
    say("Assignment updated.");
  };

  const myShifts = useMemo(
    () => db.shifts.filter((s) => s.personId === viewerId && s.date >= keyOf(new Date())).sort((a, b) => (a.date < b.date ? -1 : 1)),
    [db.shifts, viewerId]
  );
  const availableShifts = useMemo(
    () =>
      db.shifts
        .filter((s) => {
          if (!s.posted || s.personId === viewerId) return false;
          const r = openReqFor(s.id);
          return r && !r.toId;
        })
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
    [db.shifts, db.requests, viewerId]
  );
  const inbox = useMemo(
    () => db.requests.filter((r) => r.status === "submitted" && r.toId === viewerId && r.coworker === "pending"),
    [db.requests, viewerId]
  );
  const approvalQueue = useMemo(
    () => db.requests.filter((r) => r.status === "submitted" && r.toId && r.coworker !== "pending"),
    [db.requests]
  );

  const tabs = isStaff
    ? [
        { id: "home", label: "Today", icon: Home },
        { id: "mine", label: "My Shifts", icon: CalendarDays },
        { id: "requests", label: "Requests", icon: History, badge: inbox.length },
        { id: "phones", label: "Phone List", icon: Phone },
      ]
    : isMgr
    ? [
        { id: "home", label: "Today", icon: Home },
        { id: "approvals", label: "Approve", icon: ShieldCheck, badge: approvalQueue.length },
        { id: "manage", label: "Schedule", icon: ClipboardList },
        { id: "people", label: "People", icon: Users, badge: db.people.filter((p) => !p.email || !p.username).length },
        { id: "phones", label: "Phones", icon: Phone },
      ]
    : [
        { id: "home", label: "Today", icon: Home },
        { id: "requests", label: "Requests", icon: History },
        { id: "phones", label: "Phone List", icon: Phone },
      ];

  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab("home");
  }, [viewerId]); // eslint-disable-line

  const desktop = useIsDesktop();
  const section = (tabs.find((t) => t.id === tab) || {}).label || "";

  return (
    <AppCtx.Provider value={{ org, say, desktop }}>
      <style>{THEME_CSS}</style>
      <style>{PRINT_CSS}</style>
      <div
        className="w-full"
        style={{
          minHeight: "100vh",
          display: desktop ? "flex" : "block",
          padding: 0,
          boxSizing: "border-box",
          backgroundColor: C.bg,
          color: C.ink,
          fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Desktop fills the viewport edge to edge, matching the board the
            supervisors already read. A centered card would waste the width
            that makes the call list scannable in one look. The phone keeps a
            readable column so lines do not run the width of a tablet. */}
        <div
          className="oncall-window flex w-full"
          style={
            desktop
              ? {
                  height: "100vh",
                  backgroundColor: C.bg,
                  overflow: "hidden",
                }
              : { maxWidth: 448, minHeight: "100vh", flexDirection: "column", backgroundColor: C.bg, marginLeft: "auto", marginRight: "auto" }
          }
        >
          {desktop ? (
            <SideRail org={org} viewer={viewer} tabs={tabs} tab={tab} setTab={setTab} onAccount={() => setAccountOpen(true)} />
          ) : null}

          <div className="oncall-scroll flex min-w-0 flex-1 flex-col" style={desktop ? { overflowY: "auto" } : {}}>
            <div className="oncall-no-print sticky top-0 z-30" style={{ backgroundColor: org.brand }}>
              <div
                className="flex items-center justify-between px-4 pb-2 pt-3"
                style={{ paddingTop: desktop ? "0.75rem" : "calc(0.75rem + env(safe-area-inset-top))" }}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-white">{desktop ? section : org.name}</div>
                  <div className="truncate text-xs" style={{ color: "rgba(255,255,255,0.78)" }}>
                    {desktop ? `${org.name} · ${org.unit}` : org.unit}
                  </div>
                </div>
                <button
                  onClick={() => setAccountOpen(true)}
                  className="flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-2.5"
                  style={{ backgroundColor: "rgba(255,255,255,0.18)" }}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-bold" style={{ color: org.deep }}>
                    {viewer.name.split(" ").map((w) => w[0]).join("")}
                  </span>
                  {desktop ? <span className="text-xs font-medium text-white">{viewer.name}</span> : null}
                  <ChevronDown size={14} color="#fff" />
                </button>
              </div>
            </div>

            <div className="flex-1" style={desktop ? { paddingBottom: 24 } : { paddingBottom: 96 }}>
        {tab === "home" && <TodayView db={db} viewer={viewer} isStaff={isStaff} onOpenShift={setShiftSheet} onCheckIn={checkIn} say={say} />}
        {tab === "mine" && (
          <MyShiftsView
            db={db}
            viewerId={viewerId}
            myShifts={myShifts}
            availableShifts={availableShifts}
            openReqFor={openReqFor}
            onOpenShift={setShiftSheet}
            onPickUp={pickUp}
          />
        )}
        {tab === "requests" && (
          <RequestsView db={db} viewerId={viewerId} isSup={isSup} inbox={inbox} shiftById={shiftById} onRespond={respondToOffer} onRetract={retract} />
        )}
        {tab === "approvals" && <ApprovalsView db={db} queue={approvalQueue} shiftById={shiftById} onOpen={setApproveSheet} />}
        {tab === "manage" && <ManageView db={db} onReassign={reassign} onToggleSick={toggleSick} onOfferUp={offerUp} openReqFor={openReqFor} />}
        {tab === "people" && <PeopleAdminView db={db} viewerId={viewerId} onSave={savePerson} onSetActive={setPersonActive} say={say} />}
        {tab === "phones" && <PhoneListView db={db} />}
            </div>
          </div>
        </div>

      {desktop ? null : (
      <div className="oncall-no-print fixed bottom-0 left-0 right-0 z-30 mx-auto flex w-full max-w-md items-stretch border-t bg-white" style={{ borderColor: C.line, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className="relative flex flex-1 flex-col items-center gap-0.5 py-2">
              <t.icon size={20} style={{ color: active ? org.brand : C.navIdle }} />
              <span className="text-xs font-medium" style={{ color: active ? org.brand : C.navIdle }}>{t.label}</span>
              {t.badge ? (
                <span className="absolute right-5 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-xs font-bold text-white" style={{ backgroundColor: C.danger }}>
                  {t.badge}
                </span>
              ) : null}
              {active ? <span className="absolute bottom-0 h-0.5 w-10 rounded-full" style={{ backgroundColor: org.brand }} /> : null}
            </button>
          );
        })}
      </div>
      )}

      {toast ? (
        <div
          className="oncall-no-print fixed left-0 right-0 z-40 mx-auto flex w-full justify-center px-4"
          style={{ bottom: desktop ? 40 : 80, maxWidth: desktop ? 1040 : 448 }}
        >
          <div className="rounded-lg px-3.5 py-2.5 text-sm text-white shadow-lg" style={{ backgroundColor: C.toastBg }}>{toast}</div>
        </div>
      ) : null}

      <ShiftSheet
        shiftId={shiftSheet}
        db={db}
        viewerId={viewerId}
        isStaff={isStaff}
        onClose={() => setShiftSheet(null)}
        openReqFor={openReqFor}
        onOfferUp={offerUp}
        onTrade={tradeShift}
        onRetract={retract}
        onCheckIn={checkIn}
        onUndoCheckIn={undoCheckIn}
      />
      <ApproveSheet
        requestId={approveSheet}
        db={db}
        onClose={() => setApproveSheet(null)}
        onDecide={decide}
        onSetCoworker={(id, answer) => patchReq(id, { coworker: answer, respondedAt: new Date().toISOString() })}
      />
      <AccountSheet
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        org={org}
        viewer={viewer}
        onSwitchUser={(id) => {
          setViewerId(id);
          setAccountOpen(false);
          setTab("home");
        }}
        onSignOut={onSignOut}
        onSwitchOrg={onSwitchOrg}
      />
      </div>
    </AppCtx.Provider>
  );
}

/* Desktop navigation: the icon rail from the SharePoint original. */
function SideRail({ org, viewer, tabs, tab, setTab, onAccount }) {
  return (
    <div className="oncall-no-print flex w-56 shrink-0 flex-col border-r bg-white" style={{ borderColor: C.line }}>
      <button onClick={onAccount} className="flex items-center gap-2.5 border-b px-4 py-4 text-left" style={{ borderColor: C.line }}>
        <OrgTile org={org} size={34} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{org.name}</div>
          <div className="truncate text-xs" style={{ color: C.sub }}>{org.unit}</div>
        </div>
      </button>

      <div className="flex flex-1 flex-col gap-1 p-2">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition"
              style={active ? { backgroundColor: org.soft, color: org.deep } : { color: C.sub }}
            >
              <t.icon size={18} style={{ color: active ? org.brand : C.navIdle }} />
              <span className="flex-1">{t.label}</span>
              {t.badge ? (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold text-white" style={{ backgroundColor: C.danger }}>
                  {t.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <button onClick={onAccount} className="flex items-center gap-2.5 border-t px-4 py-3 text-left" style={{ borderColor: C.line }}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: org.brand }}>
          {viewer.name.split(" ").map((w) => w[0]).join("")}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{viewer.name}</div>
          <div className="truncate text-xs" style={{ color: C.sub }}>{viewer.role}</div>
        </div>
      </button>
    </div>
  );
}

/* =========================== ACCOUNT SHEET ======================== */
function AccountSheet({ open, onClose, org, viewer, onSwitchUser, onSignOut, onSwitchOrg, themeMode, setThemeMode }) {
  const [showUsers, setShowUsers] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title="Account">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: org.brand }}>
          {viewer.name.split(" ").map((w) => w[0]).join("")}
        </div>
        <div className="min-w-0">
          <div className="text-base font-semibold">{viewer.name}</div>
          <div className="text-xs" style={{ color: C.sub }}>{viewer.role}</div>
          <div className="truncate text-xs" style={{ color: C.faint, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            {viewer.username}
          </div>
          <div className="truncate text-xs" style={{ color: C.faint }}>{viewer.email || "No email on file"}</div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3 rounded-xl border p-3" style={{ borderColor: C.line }}>
        <OrgTile org={org} size={38} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{org.name}</div>
          <div className="text-xs" style={{ color: C.sub }}>{org.unit} · {org.city}</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: C.faint }}>Appearance</div>
        <div className="flex overflow-hidden rounded-lg border" style={{ borderColor: C.line }}>
          {[
            { id: "light", label: "Light", icon: Sun },
            { id: "dark", label: "Dark", icon: Moon },
            { id: "system", label: "System", icon: Monitor },
          ].map((opt, i) => {
            const active = themeMode === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setThemeMode(opt.id)}
                className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-semibold"
                style={{
                  backgroundColor: active ? org.brand : C.surface,
                  color: active ? "#fff" : C.sub,
                  borderLeft: i ? `1px solid ${C.line}` : "none",
                }}
                aria-pressed={active}
              >
                <opt.icon size={14} />
                {opt.label}
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 text-xs" style={{ color: C.faint }}>
          System follows your phone or computer's setting, including its night schedule.
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <Btn tone="ghost" full icon={Building2} onClick={onSwitchOrg}>
          Switch organization
        </Btn>
        <Btn tone="ghost" full icon={LogOut} onClick={onSignOut}>
          Sign out
        </Btn>
      </div>

      <div className="mt-5 border-t pt-3" style={{ borderColor: C.line }}>
        <button onClick={() => setShowUsers((v) => !v)} className="flex w-full items-center justify-between py-1 text-left">
          <div>
            <div className="text-sm font-semibold">Demo: view as another account</div>
            <div className="text-xs" style={{ color: C.sub }}>Only in this build — live, permissions come from sign-in.</div>
          </div>
          <Repeat size={16} style={{ color: C.faint }} />
        </button>
        {showUsers ? (
          <div className="mt-2 overflow-hidden rounded-lg border" style={{ borderColor: C.line }}>
            {org.people.map((p, i) => (
              <button
                key={p.id}
                onClick={() => onSwitchUser(p.id)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left"
                style={{ borderTop: i ? `1px solid ${C.line}` : "none", backgroundColor: p.id === viewer.id ? org.soft : "#fff" }}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="text-xs" style={{ color: C.sub }}>{p.role}</div>
                </div>
                {p.id === viewer.id ? <Check size={16} style={{ color: org.brand }} /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

/* ============================== TODAY ============================= */
function TodayView({ db, viewer, isStaff, onOpenShift, onCheckIn, say }) {
  const org = useOrg();
  const stickyTop = useStickyTop();
  const desktop = useIsDesktop();
  const [dateKey, setDateKey] = useState(() => keyOf(new Date()));
  const [role, setRole] = useState("All");
  const isToday = dateKey === keyOf(new Date());

  const rows = db.shifts
    .filter((s) => s.date === dateKey && (role === "All" || s.role === role))
    .sort((a, b) => org.roles.indexOf(a.role) - org.roles.indexOf(b.role) || a.time.localeCompare(b.time));

  const dayShifts = db.shifts.filter((s) => s.date === dateKey);
  const checked = dayShifts.filter((s) => s.checkIn).length;
  const myShiftToday = db.shifts.find((s) => s.date === keyOf(new Date()) && s.personId === viewer.id);

  const copyList = async () => {
    const text = [
      `${org.name} — on call ${longDate(dateKey)}`,
      ...rows.map((s) => {
        const p = user(org, s.personId);
        return `${s.role} ${KIND[s.kind].label} ${s.time} — ${p.name} ${p.phone}${s.outSick ? " (OUT SICK)" : ""}`;
      }),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      say("Call list copied.");
    } catch (e) {
      say("Copy unavailable on this device.");
    }
  };

  return (
    <div>
      <div className="sticky z-20 border-b bg-white px-3 py-2" style={{ borderColor: C.line, top: stickyTop }}>
        <div className="flex items-center justify-between">
          <button onClick={() => setDateKey(keyOf(addDays(fromKey(dateKey), -1)))} className="rounded-full p-2" style={{ color: org.brand }} aria-label="Previous day">
            <ChevronLeft size={20} />
          </button>
          <div className="text-center">
            <div className="text-sm font-semibold">{longDate(dateKey)}</div>
            <div className="text-xs" style={{ color: isToday ? C.ok : C.sub }}>
              {isToday ? `Today · ${checked}/${dayShifts.length} checked in` : `${dayShifts.length} on call`}
            </div>
          </div>
          <button onClick={() => setDateKey(keyOf(addDays(fromKey(dateKey), 1)))} className="rounded-full p-2" style={{ color: org.brand }} aria-label="Next day">
            <ChevronRight size={20} />
          </button>
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {["All", ...org.roles].map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className="whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium"
              style={role === r ? { backgroundColor: org.brand, color: "#fff" } : { backgroundColor: org.chip, color: org.deep }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {isStaff && myShiftToday ? (
        <div className="mx-3 mt-3 rounded-xl border bg-white p-3" style={{ borderColor: myShiftToday.checkIn ? C.okBorder : C.warnBorder }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.faint }}>Your call tonight</div>
              <div className="mt-1 text-sm font-semibold">{KIND[myShiftToday.kind].label} · {myShiftToday.time}</div>
              <div className="text-xs" style={{ color: C.sub }}>{myShiftToday.role}</div>
            </div>
            {myShiftToday.checkIn ? (
              <Pill text={`Checked in ${clock(myShiftToday.checkIn.at)}`} color={C.ok} bg={C.okBg} icon={CheckCircle2} />
            ) : (
              <Btn size="sm" icon={UserCheck} onClick={() => onCheckIn(myShiftToday.id)}>Check in</Btn>
            )}
          </div>
          {!myShiftToday.checkIn ? (
            <div className="mt-2 text-xs" style={{ color: C.sub }}>Check in confirms you're reachable. The supervisor sees it right away.</div>
          ) : null}
        </div>
      ) : null}

      <div className="hidden print:block px-3 pb-2">
        <div className="text-base font-bold">{org.name} — on call</div>
        <div className="text-sm">{longDate(dateKey)}</div>
      </div>
      {rows.length ? <TapToCallHint /> : null}
      <div className="overflow-hidden border-y bg-white" style={{ borderColor: C.line }}>
        {rows.length === 0 ? (
          <Empty icon={CalendarDays} title="No call posted for this day" hint="Try another date or clear the role filter." />
        ) : (
          rows.map((s, i) => <CallRow key={s.id} shift={s} first={i === 0} onOpen={() => onOpenShift(s.id)} />)
        )}
      </div>

      <div className="oncall-no-print flex gap-2 px-3 py-3">
        <Btn tone="ghost" full icon={Copy} onClick={copyList}>Copy this call list</Btn>
        {desktop ? (
          <Btn tone="ghost" full icon={Printer} onClick={() => window.print()}>Print</Btn>
        ) : null}
      </div>
    </div>
  );
}

function CallRow({ shift, first, onOpen }) {
  const org = useOrg();
  const desktop = useIsDesktop();
  const p = user(org, shift.personId);
  return (
    <div style={{ borderTop: first ? "none" : `1px solid ${C.line}`, padding: desktop ? "14px 20px" : "10px 12px" }}>
      <div className="flex items-start gap-3">
        <div className="w-24 shrink-0">
          <Badge kind={shift.kind} />
          <div className="mt-1 text-xs font-medium" style={{ color: C.sub, fontVariantNumeric: "tabular-nums" }}>{shift.time}</div>
        </div>
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-semibold">{p.name}</div>
          <div className="text-xs" style={{ color: org.link }}>{shift.role}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {shift.outSick ? <Pill text="Out sick" color={C.warn} bg={C.warnBg} icon={AlertCircle} /> : null}
            {shift.checkIn ? (
              <Pill text={`Checked in ${clock(shift.checkIn.at)}`} color={C.ok} bg={C.okBg} icon={CheckCircle2} />
            ) : (
              <Pill text="Not checked in" color={C.sub} bg={C.neutralBg} icon={Clock} />
            )}
            {shift.posted ? <Pill text="Posted to staff" color={org.deep} bg={org.soft} /> : null}
          </div>
        </button>
        <DialButton person={p} />
      </div>
    </div>
  );
}

/* ============================ MY SHIFTS =========================== */
function MyShiftsView({ db, viewerId, myShifts, availableShifts, openReqFor, onOpenShift, onPickUp }) {
  const org = useOrg();
  const stickyTop = useStickyTop();
  const [sub, setSub] = useState("mine");
  const viewer = user(org, viewerId);
  const [sameRoleOnly, setSameRoleOnly] = useState(true);

  const mineByMonth = useMemo(() => {
    const groups = [];
    myShifts.forEach((s) => {
      const d = fromKey(s.date);
      const label = `${MON[d.getMonth()]} ${d.getFullYear()}`;
      const g = groups.find((x) => x.label === label);
      if (g) g.items.push(s);
      else groups.push({ label, items: [s] });
    });
    return groups;
  }, [myShifts]);

  const avail = availableShifts.filter((s) => (sameRoleOnly ? s.role === viewer.role || (org.aliases && org.aliases[s.role]) === viewer.role : true));
  const pending = db.requests.filter((r) => r.status === "submitted" && (r.fromId === viewerId || r.toId === viewerId));
  const approved = db.requests.filter((r) => r.status === "approved" && (r.fromId === viewerId || r.toId === viewerId));

  const statusLine = (s) => {
    const r = openReqFor(s.id);
    if (!r) return null;
    if (r.type === "post" && !r.toId) return { text: "Post shift submitted", color: org.link };
    if (r.coworker === "pending") return { text: `Waiting on ${user(org, r.toId).name.split(" ")[0]}`, color: C.warn };
    return { text: "Pending approval", color: C.warn };
  };

  const SubTab = ({ id, label, count }) => (
    <button
      onClick={() => setSub(id)}
      className="flex-1 whitespace-nowrap px-2 py-2 text-xs font-semibold"
      style={sub === id ? { backgroundColor: org.brand, color: "#fff" } : { backgroundColor: C.surface, color: C.sub, border: `1px solid ${C.line}` }}
    >
      {label}
      {count ? ` (${count})` : ""}
    </button>
  );

  return (
    <div>
      <div className="sticky z-20 flex bg-white" style={{ top: stickyTop }}>
        <SubTab id="mine" label="Mine" count={myShifts.length} />
        <SubTab id="available" label="Available" count={avail.length} />
        <SubTab id="pending" label="Pending" count={pending.length} />
        <SubTab id="approved" label="Approved" count={approved.length} />
      </div>

      {sub === "mine" && (
        <div>
          {mineByMonth.length === 0 ? (
            <Empty icon={CalendarDays} title="No upcoming call" hint="Shifts appear here as soon as the schedule is posted." />
          ) : (
            mineByMonth.map((g) => (
              <div key={g.label}>
                <div className="px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: C.surfaceAlt, color: C.sub }}>{g.label}</div>
                <div className="bg-white">
                  {g.items.map((s, i) => {
                    const st = statusLine(s);
                    const d = fromKey(s.date);
                    return (
                      <button key={s.id} onClick={() => onOpenShift(s.id)} className="flex w-full items-center gap-3 px-3 py-3 text-left" style={{ borderTop: i ? `1px solid ${C.line}` : "none" }}>
                        <div className="w-9 shrink-0 text-center">
                          <div className="text-xs" style={{ color: org.link }}>{DOW[d.getDay()]}</div>
                          <div className="text-lg font-bold leading-tight">{d.getDate()}</div>
                        </div>
                        <div className="w-20 shrink-0"><Badge kind={s.kind} /></div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{s.time}</div>
                          <div className="text-xs" style={{ color: C.sub }}>{s.role}</div>
                          {st ? <div className="mt-0.5 text-xs font-medium" style={{ color: st.color }}>{st.text}</div> : null}
                        </div>
                        <ChevronRight size={18} style={{ color: C.chevron }} />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {sub === "available" && (
        <div>
          <div className="flex items-center justify-between px-3 py-2">
            <div className="text-xs" style={{ color: C.sub }}>Shifts your colleagues have offered up.</div>
            <button
              onClick={() => setSameRoleOnly((v) => !v)}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
              style={sameRoleOnly ? { backgroundColor: org.brand, color: "#fff" } : { backgroundColor: org.chip, color: org.deep }}
            >
              <Filter size={12} />
              {viewer.role} only
            </button>
          </div>
          <div className="bg-white">
            {avail.length === 0 ? (
              <Empty icon={CalendarDays} title="Nothing available right now" hint="Posted shifts land here the moment someone offers one up." />
            ) : (
              avail.map((s, i) => {
                const owner = user(org, s.personId);
                const d = fromKey(s.date);
                return (
                  <div key={s.id} className="px-3 py-3" style={{ borderTop: i ? `1px solid ${C.line}` : "none" }}>
                    <div className="flex items-center gap-3">
                      <div className="w-9 shrink-0 text-center">
                        <div className="text-xs" style={{ color: org.link }}>{DOW[d.getDay()]}</div>
                        <div className="text-lg font-bold leading-tight">{d.getDate()}</div>
                      </div>
                      <div className="w-20 shrink-0"><Badge kind={s.kind} /></div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{s.time}</div>
                        <div className="text-xs" style={{ color: C.sub }}>{s.role} · {owner.name}</div>
                      </div>
                      <Btn size="sm" onClick={() => onPickUp(s.id)}>Pick up</Btn>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {sub === "pending" && <RequestList db={db} list={pending} emptyTitle="Nothing pending" />}
      {sub === "approved" && <RequestList db={db} list={approved} emptyTitle="Nothing approved yet" />}
    </div>
  );
}

function RequestList({ db, list, emptyTitle }) {
  if (list.length === 0) return <Empty icon={History} title={emptyTitle} />;
  return (
    <div className="bg-white">
      {list.map((r, i) => {
        const s = db.shifts.find((x) => x.id === r.shiftId);
        if (!s) return null;
        return (
          <div key={r.id} className="px-3 py-3" style={{ borderTop: i ? `1px solid ${C.line}` : "none" }}>
            <RequestSummary req={r} shift={s} />
          </div>
        );
      })}
    </div>
  );
}

function RequestSummary({ req, shift }) {
  const org = useOrg();
  const from = user(org, req.fromId);
  const to = req.toId ? user(org, req.toId) : null;
  const typeLabel = req.type === "trade" ? "Trade Shift" : req.type === "pickup" ? "Pickup Shift" : "Post Shift";
  const state =
    req.status === "approved"
      ? { text: "Approved", color: C.ok, bg: C.okBg }
      : req.status === "denied"
      ? { text: req.coworker === "refused" ? "Co-worker refused" : "Denied", color: C.danger, bg: C.dangerBg }
      : req.status === "retracted"
      ? { text: "Retracted", color: C.sub, bg: C.neutralBg }
      : req.coworker === "agreed"
      ? { text: "Pending approval", color: C.warn, bg: C.warnBg }
      : to
      ? { text: "Waiting on co-worker", color: C.warn, bg: C.warnBg }
      : { text: "Open to staff", color: org.link, bg: org.soft };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.faint }}>{typeLabel}</div>
        <Pill text={state.text} color={state.color} bg={state.bg} />
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <Badge kind={shift.kind} />
        <div className="text-sm font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{shift.time}</div>
        <div className="text-xs" style={{ color: C.sub }}>{shortDate(shift.date)}</div>
      </div>
      <div className="mt-1 flex items-center gap-2 text-sm">
        <span className="font-medium">{from ? from.name : "—"}</span>
        <ArrowRight size={14} style={{ color: C.faint }} />
        <span className="font-medium">{to ? to.name : "Any qualified staff"}</span>
      </div>
      <div className="mt-0.5 text-xs" style={{ color: C.sub }}>{shift.role} · Submitted {stamp(req.submittedAt)}</div>
      {req.notes ? (
        <div className="mt-1.5 rounded-md px-2.5 py-1.5 text-xs" style={{ backgroundColor: C.note, color: C.sub }}>{req.notes}</div>
      ) : null}
    </div>
  );
}

/* ============================= REQUESTS =========================== */
function RequestsView({ db, viewerId, isSup, inbox, shiftById, onRespond, onRetract }) {
  const org = useOrg();
  const stickyTop = useStickyTop();
  const [sub, setSub] = useState("submitted");
  const scope = (r) => isSup || r.fromId === viewerId || r.toId === viewerId;
  const submitted = db.requests.filter((r) => r.status === "submitted" && scope(r));
  const approved = db.requests.filter((r) => r.status === "approved" && scope(r));
  const denied = db.requests.filter((r) => r.status === "denied" && scope(r));
  const retracted = db.requests.filter((r) => r.status === "retracted" && scope(r));

  const groups = [
    { key: "pickup", label: "Pickup Shift", items: submitted.filter((r) => r.type === "pickup") },
    { key: "post", label: "Post Shift", items: submitted.filter((r) => r.type === "post") },
    { key: "trade", label: "Trade Shift", items: submitted.filter((r) => r.type === "trade") },
  ];

  const SubTab = ({ id, label, count }) => (
    <button
      onClick={() => setSub(id)}
      className="whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold"
      style={{ borderColor: sub === id ? org.brand : "transparent", color: sub === id ? org.brand : C.sub }}
    >
      {label}
      {count ? ` (${count})` : ""}
    </button>
  );

  return (
    <div>
      <div className="sticky z-20 flex overflow-x-auto border-b bg-white" style={{ top: stickyTop, borderColor: C.line }}>
        <SubTab id="submitted" label="Submitted" count={submitted.length} />
        <SubTab id="approved" label="Approved" count={approved.length} />
        <SubTab id="denied" label="Denied" count={denied.length} />
        <SubTab id="retracted" label="Retracted" count={retracted.length} />
      </div>

      {sub === "submitted" && (
        <div>
          {inbox.length > 0 ? (
            <div className="px-3 pt-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: C.warn }}>Needs your answer</div>
              {inbox.map((r) => (
                <div key={r.id} className="mb-2 rounded-xl border bg-white p-3" style={{ borderColor: C.warnBorder }}>
                  <RequestSummary req={r} shift={shiftById(r.shiftId)} />
                  <div className="mt-3 flex gap-2">
                    <Btn tone="green" full icon={Check} onClick={() => onRespond(r.id, "agreed")}>I'll take it</Btn>
                    <Btn tone="danger" full icon={X} onClick={() => onRespond(r.id, "refused")}>Decline</Btn>
                  </div>
                  <div className="mt-2 text-xs" style={{ color: C.sub }}>
                    Accepting sends it to management for final approval. It isn't yours until they approve.
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {groups.every((g) => g.items.length === 0) ? (
            <Empty icon={History} title="No open requests" hint="Offer up or trade a shift from My Shifts." />
          ) : (
            groups.map((g) =>
              g.items.length ? (
                <div key={g.key}>
                  <div className="px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: C.surfaceAlt, color: C.sub }}>
                    {g.label} ({g.items.length})
                  </div>
                  <div className="bg-white">
                    {g.items.map((r, i) => (
                      <div key={r.id} className="px-3 py-3" style={{ borderTop: i ? `1px solid ${C.line}` : "none" }}>
                        <RequestSummary req={r} shift={shiftById(r.shiftId)} />
                        {r.fromId === viewerId ? (
                          <div className="mt-2">
                            <Btn size="sm" tone="ghost" icon={Undo2} onClick={() => onRetract(r.id)}>Retract request</Btn>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null
            )
          )}
        </div>
      )}

      {sub === "approved" && <RequestList db={db} list={approved} emptyTitle="Nothing approved yet" />}
      {sub === "denied" && <RequestList db={db} list={denied} emptyTitle="Nothing denied" />}
      {sub === "retracted" && <RequestList db={db} list={retracted} emptyTitle="Nothing retracted" />}
    </div>
  );
}

/* ============================ APPROVALS =========================== */
function ApprovalsView({ db, queue, shiftById, onOpen }) {
  const org = useOrg();
  const waiting = db.requests.filter((r) => r.status === "submitted" && r.toId && r.coworker === "pending");
  return (
    <div>
      <div className="px-3 pb-1 pt-3">
        <div className="text-sm font-semibold">Waiting on you</div>
        <div className="text-xs" style={{ color: C.sub }}>Co-worker has confirmed. Approve to move the shift.</div>
      </div>
      <div className="bg-white">
        {queue.length === 0 ? (
          <Empty icon={ShieldCheck} title="Approval queue is clear" />
        ) : (
          queue.map((r, i) => (
            <button key={r.id} onClick={() => onOpen(r.id)} className="block w-full px-3 py-3 text-left" style={{ borderTop: i ? `1px solid ${C.line}` : "none" }}>
              <RequestSummary req={r} shift={shiftById(r.shiftId)} />
              <div className="mt-2 flex items-center gap-1 text-xs font-semibold" style={{ color: org.brand }}>
                Review request <ChevronRight size={14} />
              </div>
            </button>
          ))
        )}
      </div>

      {waiting.length ? (
        <>
          <div className="px-3 pb-1 pt-4">
            <div className="text-sm font-semibold">Waiting on a co-worker</div>
            <div className="text-xs" style={{ color: C.sub }}>Not actionable until they confirm.</div>
          </div>
          <div className="bg-white">
            {waiting.map((r, i) => (
              <div key={r.id} className="px-3 py-3" style={{ borderTop: i ? `1px solid ${C.line}` : "none", opacity: 0.75 }}>
                <RequestSummary req={r} shift={shiftById(r.shiftId)} />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ============================== MANAGE ============================ */
function ManageView({ db, onReassign, onToggleSick, onOfferUp, openReqFor }) {
  const org = useOrg();
  const stickyTop = useStickyTop();
  const [dateKey, setDateKey] = useState(() => keyOf(new Date()));
  const rows = db.shifts
    .filter((s) => s.date === dateKey)
    .sort((a, b) => org.roles.indexOf(a.role) - org.roles.indexOf(b.role) || a.time.localeCompare(b.time));

  return (
    <div>
      <div className="sticky z-20 flex items-center justify-between border-b bg-white px-3 py-2" style={{ top: stickyTop, borderColor: C.line }}>
        <button onClick={() => setDateKey(keyOf(addDays(fromKey(dateKey), -1)))} className="rounded-full p-2" style={{ color: org.brand }} aria-label="Previous day">
          <ChevronLeft size={20} />
        </button>
        <div className="text-sm font-semibold">{longDate(dateKey)}</div>
        <button onClick={() => setDateKey(keyOf(addDays(fromKey(dateKey), 1)))} className="rounded-full p-2" style={{ color: org.brand }} aria-label="Next day">
          <ChevronRight size={20} />
        </button>
      </div>

      <TapToCallHint />
      <div className="bg-white">
        {rows.map((s, i) => {
          const pool = staffInRole(org, s.role);
          const r = openReqFor(s.id);
          return (
            <div key={s.id} className="px-3 py-3" style={{ borderTop: i ? `1px solid ${C.line}` : "none" }}>
              <div className="flex items-center gap-2">
                <Badge kind={s.kind} />
                <div className="text-sm font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{s.time}</div>
                <div className="text-xs" style={{ color: org.link }}>{s.role}</div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <select
                  value={s.personId}
                  onChange={(e) => onReassign(s.id, e.target.value)}
                  className="min-w-0 flex-1 rounded-md border px-2 py-2 text-sm"
                  style={{ borderColor: C.line, backgroundColor: C.surface, color: C.ink }}
                >
                  {pool.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => onToggleSick(s.id)}
                  className="rounded-md px-2.5 py-2 text-xs font-semibold"
                  style={s.outSick ? { backgroundColor: C.warnBg, color: C.warn, border: `1px solid ${C.warnBorder}` } : { backgroundColor: C.surface, color: C.sub, border: `1px solid ${C.line}` }}
                >
                  Out sick
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {r ? (
                    <Pill text={r.toId ? `Taken by ${user(org, r.toId).name}` : "Posted to staff"} color={org.deep} bg={org.soft} />
                  ) : (
                    <Btn size="sm" tone="ghost" onClick={() => onOfferUp(s.id, "Posted by management", false)}>Post shift to staff</Btn>
                  )}
                  {s.checkIn ? <Pill text={`Checked in ${clock(s.checkIn.at)}`} color={C.ok} bg={C.okBg} icon={CheckCircle2} /> : null}
                </div>
                <DialButton person={user(org, s.personId)} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------- contacting people --------------------------- */
const digitsOf = (n) => String(n || "").replace(/[^0-9+]/g, "");

/* Hands the number to the OS. Anchors alone get swallowed inside embedded
   frames, so fall back to a new context and then to direct navigation. */
function openScheme(href) {
  try {
    const w = window.open(href, "_blank");
    if (w) return true;
  } catch (e) {
    /* blocked — try navigation below */
  }
  try {
    window.location.href = href;
    return true;
  } catch (e) {
    return false;
  }
}

/* Tap-to-dial. The number is the button. Where the dialer is not reachable we
   don't pretend: copy the number and say what happened. See canDial below. */
const framed = (() => {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
})();

/* Whether a tel: link actually reaches a dialer. Three cases, not two: a
   phone opens the keypad, an embedded frame blocks the scheme outright, and a
   desktop browser hands tel: to whatever helper app is registered — usually
   nothing, so the click looks broken with no feedback. Only the first should
   navigate; the other two copy the number instead. */
const canDial = (() => {
  if (framed) return false;
  try {
    /* The native shell always has a dialer, whatever the pointer looks like. */
    if (window.Capacitor?.isNativePlatform?.()) return true;
    return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  } catch (e) {
    return false;
  }
})();

function DialButton({ person, variant = "chip" }) {
  const org = useOrg();
  const say = useSay();
  if (!person) return null;
  if (!person.phone && !person.alt) {
    return <span className="text-xs" style={{ color: C.faint }}>No number on file</span>;
  }

  const primary = person.phone || person.alt;
  const second = person.phone && person.alt ? person.alt : "";

  const dial = async (e, value) => {
    if (canDial) return; // let the anchor open the keypad
    e.preventDefault();
    if (framed) {
      /* A frame may still let a new context through, so it is worth a try. */
      try {
        window.open(`tel:${digitsOf(value)}`, "_blank");
      } catch (err) {
        /* blocked in preview, copied below */
      }
    }
    let copied = false;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch (err) {
      /* clipboard refused — still say the number so it can be read off */
    }
    if (framed) {
      say(copied
        ? `Preview blocks the dialer — ${value} copied. On a phone this opens the keypad.`
        : `Preview blocks the dialer. On a phone this calls ${value}.`);
    } else {
      say(copied
        ? `${value} copied — this computer can't place calls.`
        : `This computer can't place calls. ${person.name} is at ${value}.`);
    }
  };

  const callLabel = (value) =>
    canDial ? `Call ${person.name} at ${value}` : `Copy ${person.name}'s number, ${value}`;

  const selectable = { userSelect: "text", WebkitUserSelect: "text", WebkitTouchCallout: "default" };

  if (variant === "bar") {
    return (
      <a
        href={`tel:${digitsOf(primary)}`}
        onClick={(e) => dial(e, primary)}
        role="button"
        aria-label={callLabel(primary)}
        className="flex flex-1 items-center justify-center gap-2 rounded-lg py-3 text-sm font-bold text-white shadow-sm transition active:opacity-75"
        style={{ backgroundColor: org.brand, fontVariantNumeric: "tabular-nums", ...selectable }}
      >
        <Phone size={16} fill="currentColor" /> {canDial ? "Call" : "Copy"} {primary}
      </a>
    );
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <a
        href={`tel:${digitsOf(primary)}`}
        onClick={(e) => dial(e, primary)}
        role="button"
        aria-label={callLabel(primary)}
        className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white shadow-sm transition active:opacity-75"
        style={{ backgroundColor: org.brand, fontVariantNumeric: "tabular-nums", ...selectable }}
      >
        <Phone size={13} fill="currentColor" />
        {primary}
      </a>
      {second ? (
        <a
          href={`tel:${digitsOf(second)}`}
          onClick={(e) => dial(e, second)}
          role="button"
          aria-label={callLabel(second)}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition active:opacity-75"
          style={{ backgroundColor: C.surface, color: org.deep, border: `1px solid ${org.brand}`, fontVariantNumeric: "tabular-nums", ...selectable }}
        >
          <Phone size={11} /> 2nd {second}
        </a>
      ) : null}
    </div>
  );
}

function TapToCallHint() {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 text-xs" style={{ color: C.faint }}>
      <Phone size={12} /> {canDial ? "Tap a phone number to call." : "Click a phone number to copy it."}
    </div>
  );
}

/* ========================== PEOPLE (ADMIN) ======================== */
function PeopleAdminView({ db, viewerId, onSave, onSetActive, say }) {
  const org = useOrg();
  const stickyTop = useStickyTop();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null); // person object or "new"

  const needsSetup = db.people.filter((p) => !p.username || !p.email);
  const list = db.people.filter(
    (p) =>
      q.trim() === "" ||
      p.name.toLowerCase().includes(q.toLowerCase()) ||
      (p.username || "").toLowerCase().includes(q.toLowerCase()) ||
      p.role.toLowerCase().includes(q.toLowerCase())
  );

  const blank = () => ({
    id: `${org.id}-u${Math.random().toString(36).slice(2, 7)}`,
    name: "",
    role: org.roles[0],
    kind: "staff",
    username: "",
    email: "",
    phone: "",
    alt: "",
    active: true,
  });

  return (
    <div>
      <div className="sticky z-20 border-b bg-white px-3 py-2" style={{ top: stickyTop, borderColor: C.line }}>
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-md border px-2.5 py-2" style={{ borderColor: C.line }}>
            <Search size={16} style={{ color: C.faint }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people or usernames" className="w-full text-sm outline-none" />
          </div>
          <Btn size="sm" icon={UserPlus} onClick={() => setEditing(blank())}>
            Add
          </Btn>
        </div>
      </div>

      {needsSetup.length ? (
        <div className="mx-3 mt-3 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: C.warnBg, color: C.warn }}>
          {needsSetup.length} {needsSetup.length === 1 ? "account needs" : "accounts need"} a username or email before they can sign in.
        </div>
      ) : null}

      <div className="mt-3 bg-white">
        {list.length === 0 ? (
          <Empty icon={Users} title="No one matches that search" />
        ) : (
          list.map((p, i) => {
            const incomplete = !p.username || !p.email;
            return (
              <div
                key={p.id}
                className="flex w-full items-center gap-3 px-3 py-3 text-left"
                style={{ borderTop: i ? `1px solid ${C.line}` : "none", opacity: p.active === false ? 0.55 : 1 }}
              >
                <button onClick={() => setEditing({ ...p })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: org.brand }}>
                    {p.name.split(" ").map((w) => w[0]).join("")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold">{p.name}</span>
                      {p.kind !== "staff" ? <Pill text={p.kind === "manager" ? "Admin" : "Supervisor"} color={org.deep} bg={org.soft} /> : null}
                      {p.active === false ? <Pill text="Inactive" color={C.sub} bg={C.neutralBg} /> : null}
                    </div>
                    <div className="truncate text-xs" style={{ color: C.sub }}>{p.role}</div>
                    <div className="mt-0.5 truncate text-xs" style={{ color: incomplete ? C.warn : C.faint, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                      {p.username || "no username"} · {p.email || "no email"}
                    </div>
                  </div>
                </button>
                <div className="shrink-0 text-right text-xs" style={{ color: C.sub, fontVariantNumeric: "tabular-nums" }}>
                  {p.phone || "no phone"}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="px-3 py-4 text-xs" style={{ color: C.faint }}>
        Staff sign in with the username you set here. Email is used for approval notices and password resets — they never type it.
      </div>

      <PersonSheet
        person={editing}
        people={db.people}
        viewerId={viewerId}
        onClose={() => setEditing(null)}
        onSave={(p) => {
          onSave(p);
          setEditing(null);
        }}
        onSetActive={(id, active) => {
          onSetActive(id, active);
          setEditing(null);
        }}
        say={say}
      />
    </div>
  );
}

function PersonSheet({ person, people, viewerId, onClose, onSave, onSetActive, say }) {
  const org = useOrg();
  const [form, setForm] = useState(person);
  const [touchedUser, setTouchedUser] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(person);
    setTouchedUser(!!(person && person.username));
    setError("");
  }, [person]);

  if (!form) return null;
  const isNew = !people.some((p) => p.id === form.id);
  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setError("");
  };

  const onNameChange = (name) => {
    if (!touchedUser) {
      const taken = people.filter((p) => p.id !== form.id).map((p) => p.username);
      set({ name, username: name.trim() ? suggestUsername(name, taken) : "" });
    } else {
      set({ name });
    }
  };

  const validate = () => {
    const name = form.name.trim();
    const username = (form.username || "").trim().toLowerCase();
    const email = (form.email || "").trim().toLowerCase();
    if (!name) return "Enter a full name.";
    if (!username) return "Set a username. They sign in with it.";
    if (!/^[a-z0-9._-]{3,}$/.test(username)) return "Usernames use at least 3 letters, numbers, dots, dashes, or underscores — no spaces.";
    if (people.some((p) => p.id !== form.id && (p.username || "").toLowerCase() === username))
      return `${username} is already used at ${org.name}. Pick another.`;
    if (!email) return "Add a work email. Notices and password resets go there.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "That email address isn't valid.";
    if (people.some((p) => p.id !== form.id && (p.email || "").toLowerCase() === email))
      return `${email} is already on another account at ${org.name}.`;
    return "";
  };

  const submit = () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    onSave({
      ...form,
      name: form.name.trim(),
      username: form.username.trim().toLowerCase(),
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim(),
      alt: (form.alt || "").trim(),
    });
  };

  const label = (t) => <div className="mb-1 text-xs font-semibold" style={{ color: C.sub }}>{t}</div>;
  const field = { borderColor: C.line, backgroundColor: C.surface };

  return (
    <Sheet open={!!form} onClose={onClose} title={isNew ? "Add person" : "Edit person"}>
      <div className="space-y-3">
        <div>
          {label("Full name")}
          <input
            value={form.name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Marisa Boyd"
            className="w-full rounded-md border px-3 py-2.5 text-sm outline-none"
            style={field}
          />
        </div>

        <div>
          {label("Username")}
          <input
            value={form.username || ""}
            onChange={(e) => {
              setTouchedUser(true);
              set({ username: e.target.value.replace(/\s/g, "").toLowerCase() });
            }}
            autoCapitalize="none"
            spellCheck={false}
            placeholder="mboyd"
            className="w-full rounded-md border px-3 py-2.5 text-sm outline-none"
            style={{ ...field, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          />
          <div className="mt-1 text-xs" style={{ color: C.faint }}>
            Suggested from the name. Unique inside {org.name} — other organizations can reuse it.
          </div>
        </div>

        <div>
          {label("Work email")}
          <input
            value={form.email || ""}
            onChange={(e) => set({ email: e.target.value })}
            inputMode="email"
            autoCapitalize="none"
            placeholder={`first.last@${org.domain}`}
            className="w-full rounded-md border px-3 py-2.5 text-sm outline-none"
            style={field}
          />
          <div className="mt-1 text-xs" style={{ color: C.faint }}>Tied to the username. Used for approval notices and password resets.</div>
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            {label("Role")}
            <select value={form.role} onChange={(e) => set({ role: e.target.value })} className="w-full rounded-md border px-2 py-2.5 text-sm" style={field}>
              {org.roles.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
              {org.roles.includes(form.role) ? null : <option value={form.role}>{form.role}</option>}
            </select>
          </div>
          <div className="flex-1">
            {label("Access")}
            <select value={form.kind} onChange={(e) => set({ kind: e.target.value })} className="w-full rounded-md border px-2 py-2.5 text-sm" style={field}>
              <option value="staff">Staff</option>
              <option value="supervisor">Supervisor</option>
              <option value="manager">Admin</option>
            </select>
          </div>
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            {label("Primary phone")}
            <input
              value={form.phone || ""}
              onChange={(e) => set({ phone: e.target.value })}
              inputMode="tel"
              placeholder="(206) 555-0100"
              className="w-full rounded-md border px-3 py-2.5 text-sm outline-none"
              style={field}
            />
          </div>
          <div className="flex-1">
            {label("Second phone")}
            <input
              value={form.alt || ""}
              onChange={(e) => set({ alt: e.target.value })}
              inputMode="tel"
              placeholder="Optional"
              className="w-full rounded-md border px-3 py-2.5 text-sm outline-none"
              style={field}
            />
          </div>
        </div>

        {error ? (
          <div className="flex items-start gap-1.5 rounded-md px-3 py-2 text-xs" style={{ backgroundColor: C.dangerBg, color: C.danger }}>
            <AlertCircle size={13} className="mt-0.5 shrink-0" /> {error}
          </div>
        ) : null}

        <div className="flex gap-2 pt-1">
          <Btn tone="ghost" full onClick={onClose}>Cancel</Btn>
          <Btn full icon={Check} onClick={submit}>{isNew ? "Add person" : "Save changes"}</Btn>
        </div>

        {!isNew ? (
          <div className="border-t pt-3" style={{ borderColor: C.line }}>
            <Btn
              tone="ghost"
              full
              icon={Mail}
              onClick={() => say(form.email ? `Password reset sent to ${form.email}.` : "Add an email first — resets have nowhere to go.")}
            >
              Send password reset
            </Btn>
            {form.id === viewerId ? (
              <div className="mt-2 text-center text-xs" style={{ color: C.faint }}>This is your own account.</div>
            ) : (
              <div className="mt-2">
                <Btn
                  tone={form.active === false ? "ghost" : "danger"}
                  full
                  icon={form.active === false ? Check : Lock}
                  onClick={() => onSetActive(form.id, form.active === false)}
                >
                  {form.active === false ? "Reactivate account" : "Deactivate account"}
                </Btn>
                <div className="mt-1.5 text-center text-xs" style={{ color: C.faint }}>
                  Deactivating blocks sign-in but keeps their call history.
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

/* ============================ PHONE LIST ========================== */
function PhoneListView({ db }) {
  const org = useOrg();
  const stickyTop = useStickyTop();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("All");
  const today = keyOf(new Date());
  const onCallToday = new Set(db.shifts.filter((s) => s.date === today).map((s) => s.personId));
  const deptOf = (p) => org.depts[p.role] || "Management";
  const depts = ["All", ...Array.from(new Set(org.people.map(deptOf)))];

  const filtered = org.people.filter(
    (p) =>
      (dept === "All" || deptOf(p) === dept) &&
      (q.trim() === "" || p.name.toLowerCase().includes(q.trim().toLowerCase()) || p.role.toLowerCase().includes(q.trim().toLowerCase()))
  );

  const groups = [];
  filtered.forEach((p) => {
    const d = deptOf(p);
    const g = groups.find((x) => x.label === d);
    if (g) g.items.push(p);
    else groups.push({ label: d, items: [p] });
  });
  groups.sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div>
      <div className="sticky z-20 border-b bg-white px-3 py-2" style={{ top: stickyTop, borderColor: C.line }}>
        <div className="flex items-center gap-2 rounded-md border px-2.5 py-2" style={{ borderColor: C.line }}>
          <Search size={16} style={{ color: C.faint }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names or roles" className="w-full text-sm outline-none" style={{ color: C.ink }} />
          {q ? (
            <button onClick={() => setQ("")} aria-label="Clear search">
              <X size={16} style={{ color: C.faint }} />
            </button>
          ) : null}
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
          {depts.map((d) => (
            <button
              key={d}
              onClick={() => setDept(d)}
              className="whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium"
              style={dept === d ? { backgroundColor: org.brand, color: "#fff" } : { backgroundColor: org.chip, color: org.deep }}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <Empty icon={Users} title="No one matches that search" hint="Try a last name or a role." />
      ) : (
        groups.map((g) => (
          <div key={g.label}>
            <div className="px-3 py-1.5 text-xs font-bold" style={{ backgroundColor: C.surfaceAlt, color: C.sub }}>{g.label}</div>
            <div className="bg-white">
              {g.items.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3 px-3 py-2.5" style={{ borderTop: i ? `1px solid ${C.line}` : "none" }}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {onCallToday.has(p.id) ? <CheckCircle2 size={14} style={{ color: org.brand }} /> : null}
                      <span className="truncate text-sm font-semibold">{p.name}</span>
                    </div>
                    <div className="text-xs" style={{ color: C.sub }}>{p.role}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end" style={{ fontVariantNumeric: "tabular-nums" }}>
                    <span className="text-xs font-semibold" style={{ color: C.ink }}>{p.phone || "—"}</span>
                    {p.alt ? <span className="text-xs" style={{ color: C.sub }}>2nd {p.alt}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
      <div className="px-3 py-3 text-xs" style={{ color: C.faint }}>A check mark means the person is on the call schedule today.</div>
    </div>
  );
}

/* ============================ SHIFT SHEET ========================= */
function ShiftSheet({ shiftId, db, viewerId, isStaff, onClose, openReqFor, onOfferUp, onTrade, onRetract, onCheckIn, onUndoCheckIn }) {
  const org = useOrg();
  const shift = shiftId ? db.shifts.find((s) => s.id === shiftId) : null;
  const [mode, setMode] = useState(null);
  const [toId, setToId] = useState("");
  const [notes, setNotes] = useState("");
  const [partial, setPartial] = useState(false);

  useEffect(() => {
    setMode(null);
    setToId("");
    setNotes("");
    setPartial(false);
  }, [shiftId]);

  if (!shift) return null;
  const person = user(org, shift.personId);
  const req = openReqFor(shift.id);
  const mine = shift.personId === viewerId;
  const isToday = shift.date === keyOf(new Date());
  const d = fromKey(shift.date);
  const step = !req ? -1 : req.coworker === "agreed" ? 1 : 0;
  const coworkers = staffInRole(org, shift.role).filter((p) => p.id !== shift.personId);

  return (
    <Sheet open={!!shift} onClose={onClose} title="Call shift">
      <div className="flex items-center gap-4 rounded-xl border p-3" style={{ borderColor: C.line }}>
        <div className="w-12 shrink-0 text-center">
          <div className="text-sm font-medium" style={{ color: org.link }}>{DOW[d.getDay()]}</div>
          <div className="text-2xl font-bold leading-tight">{d.getDate()}</div>
          <div className="text-sm" style={{ color: org.link }}>{MON_S[d.getMonth()]}</div>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge kind={shift.kind} />
            <span className="text-sm font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>({shift.time})</span>
          </div>
          <div className="mt-1 text-sm font-medium" style={{ color: org.link }}>{person.name}</div>
          <div className="text-sm" style={{ color: C.sub }}>{shift.role}</div>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <DialButton person={person} variant="bar" />
        {mine && isToday ? (
          shift.checkIn ? (
            <Btn tone="ghost" icon={Undo2} onClick={() => onUndoCheckIn(shift.id)}>Checked in {clock(shift.checkIn.at)}</Btn>
          ) : (
            <Btn icon={UserCheck} onClick={() => onCheckIn(shift.id)}>Check in</Btn>
          )
        ) : null}
      </div>

      {shift.outSick ? (
        <div className="mt-3 rounded-md px-3 py-2 text-xs font-medium" style={{ backgroundColor: C.warnBg, color: C.warn }}>
          Marked out sick — management is arranging coverage.
        </div>
      ) : null}

      {mine && isStaff ? (
        <div className="mt-4 border-t pt-2" style={{ borderColor: C.line }}>
          <Stepper step={step} />

          {req ? (
            <div className="rounded-xl border p-3" style={{ borderColor: C.line }}>
              <RequestSummary req={req} shift={shift} />
              <div className="mt-3">
                <Btn tone="ghost" full icon={Undo2} onClick={() => { onRetract(req.id); onClose(); }}>Retract request</Btn>
              </div>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <button
                  onClick={() => setMode("post")}
                  className="flex-1 rounded-md py-2.5 text-sm font-semibold"
                  style={mode === "post" ? { backgroundColor: org.brand, color: "#fff", border: `1px solid ${org.brand}` } : { backgroundColor: C.surface, color: C.ink, border: `1px solid ${C.line}` }}
                >
                  Offer up
                </button>
                <button
                  onClick={() => setMode("trade")}
                  className="flex-1 rounded-md py-2.5 text-sm font-semibold"
                  style={mode === "trade" ? { backgroundColor: org.brand, color: "#fff", border: `1px solid ${org.brand}` } : { backgroundColor: C.surface, color: C.ink, border: `1px solid ${C.line}` }}
                >
                  Trade shift
                </button>
              </div>
              <div className="mt-1.5 text-xs" style={{ color: C.sub }}>
                {mode === "trade"
                  ? "Goes to one co-worker. They confirm, then management approves."
                  : mode === "post"
                  ? "Any qualified co-worker can claim it. Whoever picks it up is confirming."
                  : "Offer up posts it to all qualified staff. Trade sends it to one person."}
              </div>

              {mode ? (
                <div className="mt-3">
                  <label className="flex items-center gap-2 py-1 text-sm">
                    <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} className="h-4 w-4" />
                    Partial shift request
                  </label>

                  {mode === "trade" ? (
                    <div className="mt-2">
                      <div className="mb-1 text-xs font-semibold" style={{ color: C.sub }}>Giving to</div>
                      <select
                        value={toId}
                        onChange={(e) => setToId(e.target.value)}
                        className="w-full rounded-md border px-2.5 py-2.5 text-sm"
                        style={{ borderColor: C.line, backgroundColor: C.surface }}
                      >
                        <option value="">Select a co-worker…</option>
                        {coworkers.map((p) => (
                          <option key={p.id} value={p.id}>{p.name} — {p.role}</option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  <div className="mt-2">
                    <div className="mb-1 text-xs font-semibold" style={{ color: C.sub }}>Notes / comments</div>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                      placeholder="Anything the approver should know"
                      className="w-full rounded-md border px-2.5 py-2 text-sm"
                      style={{ borderColor: C.line }}
                    />
                  </div>

                  <div className="mt-3 flex gap-2">
                    <Btn tone="ghost" full onClick={() => setMode(null)}>Cancel</Btn>
                    <Btn
                      full
                      icon={Send}
                      disabled={mode === "trade" && !toId}
                      onClick={() => {
                        if (mode === "post") onOfferUp(shift.id, notes, partial);
                        else onTrade(shift.id, toId, notes, partial);
                        onClose();
                      }}
                    >
                      Send request
                    </Btn>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {!mine && req && !req.toId && isStaff ? (
        <div className="mt-4 rounded-xl border p-3" style={{ borderColor: C.line }}>
          <div className="text-sm font-semibold">{person.name} offered this shift up</div>
          <div className="mt-1 text-xs" style={{ color: C.sub }}>Pick it up from My Shifts › Available. Management still has to approve it.</div>
        </div>
      ) : null}
    </Sheet>
  );
}

/* ========================== APPROVE SHEET ========================= */
function ApproveSheet({ requestId, db, onClose, onDecide, onSetCoworker }) {
  const org = useOrg();
  const req = requestId ? db.requests.find((r) => r.id === requestId) : null;
  const [email, setEmail] = useState(false);
  const [kronos, setKronos] = useState(false);

  useEffect(() => {
    setEmail(false);
    setKronos(false);
  }, [requestId]);

  if (!req) return null;
  const shift = db.shifts.find((s) => s.id === req.shiftId);
  const from = user(org, req.fromId);
  const to = req.toId ? user(org, req.toId) : null;
  const confirmed = req.coworker === "agreed";
  const typeLabel = req.type === "trade" ? "Trade Shift" : req.type === "pickup" ? "Pickup Shift" : "Post Shift";
  const conflict = db.shifts.some((s) => s.date === shift.date && s.personId === req.toId && s.id !== shift.id);

  return (
    <Sheet open={!!req} onClose={onClose} title="Approve or deny request">
      <div className="text-sm font-semibold">{typeLabel}</div>
      <div className="mt-1.5 rounded-lg border p-3" style={{ borderColor: C.line }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold">{from ? from.name : "—"}</div>
            <div className="mt-0.5 text-sm" style={{ color: C.sub, fontVariantNumeric: "tabular-nums" }}>{shift.time} · {shortDate(shift.date)}</div>
            <div className="text-sm" style={{ color: C.sub }}>{KIND[shift.kind].label} · {shift.role}</div>
          </div>
        </div>
      </div>

      <div className="mt-3 text-sm font-semibold">Giving shift to</div>
      <div className="mt-1.5 rounded-lg border p-3" style={{ borderColor: C.line }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold">{to ? to.name : "—"}</div>
            <div className="mt-0.5 text-xs" style={{ color: C.sub }}>Submitted {stamp(req.submittedAt)}</div>
          </div>
        </div>
        <div className="mt-2">
          {confirmed ? (
            <Pill text={`Confirmed ${req.respondedAt ? stamp(req.respondedAt) : ""}`} color={org.link} bg={org.soft} icon={CheckCircle2} />
          ) : (
            <Pill text="Not confirmed" color={C.warn} bg={C.warnBg} icon={AlertCircle} />
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <Btn tone="green" size="sm" full icon={Check} onClick={() => onSetCoworker(req.id, "agreed")}>Employee agreed</Btn>
          <Btn tone="amber" size="sm" full icon={X} onClick={() => onSetCoworker(req.id, "refused")}>Employee refused</Btn>
        </div>
        <div className="mt-1.5 text-xs" style={{ color: C.faint }}>Use these if the employee confirmed by phone instead of in the app.</div>
      </div>

      {req.notes ? (
        <div className="mt-3 rounded-md px-3 py-2 text-xs" style={{ backgroundColor: C.note, color: C.sub }}>“{req.notes}”</div>
      ) : null}

      {conflict && to ? (
        <div className="mt-3 flex items-start gap-2 rounded-md px-3 py-2 text-xs" style={{ backgroundColor: C.dangerBg, color: C.danger }}>
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{to.name} is already on the schedule that day. Check for a double-book before approving.</span>
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        <label className="flex items-center gap-2 text-sm" style={{ opacity: to && to.email ? 1 : 0.55 }}>
          <input
            type="checkbox"
            checked={email && !!(to && to.email)}
            disabled={!(to && to.email)}
            onChange={(e) => setEmail(e.target.checked)}
            className="h-4 w-4"
          />
          <Mail size={14} style={{ color: C.sub }} />
          {to && to.email ? `Send email reply to ${to.email}` : "No email on file — add one in People"}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={kronos} onChange={(e) => setKronos(e.target.checked)} className="h-4 w-4" />
          <ClipboardList size={14} style={{ color: C.sub }} /> Updated KRONOS
        </label>
      </div>

      <div className="mt-4 flex gap-2">
        <Btn tone="ghost" full onClick={onClose}>Cancel</Btn>
        <Btn tone="danger" full icon={X} disabled={req.coworker === "pending"} onClick={() => onDecide(req.id, false, { email, kronos })}>Deny</Btn>
        <Btn tone="green" full icon={Check} disabled={!confirmed} onClick={() => onDecide(req.id, true, { email, kronos })}>Approve</Btn>
      </div>
      {!confirmed ? (
        <div className="mt-2 text-center text-xs" style={{ color: C.sub }}>Approve unlocks once the co-worker confirms they'll take the shift.</div>
      ) : null}
    </Sheet>
  );
}
