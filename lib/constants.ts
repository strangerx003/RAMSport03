export type ModuleKey =
  | "pbs"
  | "register"
  | "dfmea"
  | "fmeca"
  | "pm"
  | "spares"
  | "safety"
  | "fta"
  | "rbd"
  | "reports";

export type Role = "super_admin" | "company_admin" | "employee" | "reviewer";
export type Grant = "none" | "read" | "write";

/**
 * Section URLs are project-free and human-readable: module keys map to their
 * final URL slug. "register" keeps its spoken name in the tree.
 */
const MODULE_SLUGS: Partial<Record<ModuleKey, string>> = {
  register: "data-register",
};

export function moduleSlug(key: string): string {
  return MODULE_SLUGS[key as ModuleKey] ?? key;
}

export function moduleHref(key: string): string {
  return `/${moduleSlug(key)}`;
}

export const MODULE_LIST: {
  key: ModuleKey;
  num: string;
  name: string;
  short: string;
  blurb: string;
  formula: string;
  group: "Structure" | "Analysis" | "Safety" | "Operations" | "Output";
}[] = [
  {
    key: "pbs",
    num: "01",
    name: "Product Breakdown Structure",
    short: "PBS",
    blurb: "The hierarchy every other module reads from.",
    formula: "parent → child",
    group: "Structure",
  },
  {
    key: "register",
    num: "02",
    name: "Data Register",
    short: "Data Register",
    blurb: "One editable spreadsheet for every component, λ, MTTR and derived metric.",
    formula: "MTBF = 1/λ · A = 1/(1 + λ·MTTR) · FIT = λ × 10⁹",
    group: "Structure",
  },
  {
    key: "fmeca",
    num: "03",
    name: "FMECA",
    short: "FMECA",
    blurb: "MIL-STD-1629A criticality, live-priced from the Data Register.",
    formula: "Cm = β · α · λ · T",
    group: "Analysis",
  },
  {
    key: "pm",
    num: "04",
    name: "Preventive Maintenance",
    short: "PM",
    blurb: "Intervals, due dates and completion history.",
    formula: "next = last + interval",
    group: "Operations",
  },
  {
    key: "spares",
    num: "05",
    name: "Spare Parts",
    short: "Spares",
    blurb: "Poisson demand, reorder points and holding cost.",
    formula: "ROP = μ + z·√μ",
    group: "Operations",
  },
  {
    key: "safety",
    num: "06",
    name: "Safety Analysis",
    short: "Safety",
    blurb: "Hazard register, controls hierarchy and ALARP.",
    formula: "risk = severity × likelihood",
    group: "Safety",
  },
  {
    key: "fta",
    num: "07",
    name: "Fault Tree Analysis",
    short: "FTA",
    blurb: "Cause-and-effect links, Q(t) and minimal cut sets.",
    formula: "Q(t) = 1 − Π(1 − qi)",
    group: "Analysis",
  },
  {
    key: "rbd",
    num: "08",
    name: "Reliability Block Diagram",
    short: "RBD",
    blurb: "Series, parallel and k-out-of-n stages. IEC 61078.",
    formula: "Rsys = Π Rstage",
    group: "Analysis",
  },
  {
    key: "reports",
    num: "09",
    name: "Reports",
    short: "Reports",
    blurb: "Frozen snapshots exported to Excel.",
    formula: "snapshot → workbook",
    group: "Output",
  },
];

export const MODULES: Record<string, (typeof MODULE_LIST)[number]> = Object.fromEntries(
  MODULE_LIST.map((m) => [m.key, m]),
);

export const BUNDLES: {
  key: string;
  name: string;
  count: number;
  modules: ModuleKey[];
  note: string;
}[] = [
  {
    key: "reliability_starter",
    name: "Reliability Starter",
    count: 3,
    modules: ["pbs", "register", "reports"],
    note: "Where most reliability analyses start",
  },
  {
    key: "reliability_failure",
    name: "Reliability + Failure Analysis",
    count: 5,
    modules: ["pbs", "register", "fmeca", "rbd", "reports"],
    note: "For when 'it might fail' is not good enough",
  },
  {
    key: "safety_essentials",
    name: "Safety Essentials",
    count: 5,
    modules: ["pbs", "register", "fmeca", "safety", "reports"],
    note: "Where reliability data becomes a safety case",
  },
  {
    key: "safety_fault_tree",
    name: "Safety + Fault Tree",
    count: 7,
    modules: ["pbs", "register", "fmeca", "safety", "fta", "rbd", "reports"],
    note: "For systems where one failure cannot cascade",
  },
  {
    key: "maintenance_spares",
    name: "Maintenance & Spares",
    count: 7,
    modules: ["pbs", "register", "fmeca", "pm", "spares", "safety", "reports"],
    note: "Turns failure data into a maintenance plan",
  },
  {
    key: "full_suite",
    name: "Full Suite",
    count: 9,
    modules: [
      "pbs",
      "register",
      "fmeca",
      "pm",
      "spares",
      "safety",
      "fta",
      "rbd",
      "reports",
    ],
    note: "Everything, one licence, one login",
  },
];

export const BUNDLE_BY_KEY: Record<string, (typeof BUNDLES)[number]> = Object.fromEntries(
  BUNDLES.map((b) => [b.key, b]),
);

export const ROLES: { key: Role; name: string; hint: string }[] = [
  { key: "super_admin", name: "Super Admin", hint: "Platform owner. Full access to every project." },
  { key: "company_admin", name: "Company Admin", hint: "Manages projects, people and licences." },
  { key: "employee", name: "Employee", hint: "Read/write only where granted, module by module." },
  { key: "reviewer", name: "Reviewer", hint: "Read-only everywhere. Cannot change an analysis." },
];

export const PM_UNITS = ["hours", "days", "weeks", "months", "cycles"] as const;
export const NODE_LEVELS = ["system", "subsystem", "assembly", "component"] as const;
export const NODE_CATEGORIES = ["electronic", "mechanical", "software", "other"] as const;

export const LEVEL_LABEL: Record<string, string> = {
  system: "System",
  subsystem: "Subsystem",
  assembly: "Assembly",
  component: "Component",
};

export function nextLevel(level: string): string {
  const i = NODE_LEVELS.indexOf(level as (typeof NODE_LEVELS)[number]);
  if (i < 0) return "component";
  return NODE_LEVELS[Math.min(i + 1, NODE_LEVELS.length - 1)];
}

export function bundleModules(key: string): ModuleKey[] {
  return BUNDLE_BY_KEY[key]?.modules ?? BUNDLE_BY_KEY.reliability_starter.modules;
}

export function moduleCount(key: string): number {
  return bundleModules(key).length;
}
