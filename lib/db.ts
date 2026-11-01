import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SCHEMA } from "@/lib/schema";
import { hashPassword } from "@/lib/auth";
import { reliability } from "@/lib/calc";
import { recomputeProject } from "@/lib/recompute";
import { snapshotProject } from "@/lib/snapshot";
import { bundleModules } from "@/lib/constants";

const globalRef = globalThis as unknown as { __reliaDb?: DatabaseSync };

/* ------------------------------------------------------------------ bootstrap */

export function getDb(): DatabaseSync {
  if (globalRef.__reliaDb) return globalRef.__reliaDb;

  const preferredDir = process.env.RELIA_DATA_DIR || path.join(process.cwd(), "data");
  let dir = preferredDir;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, "reports"), { recursive: true });
  } catch {
    /* Vercel serverless filesystem (/var/task) is read-only. Fall back to /tmp
       which is writable. Seed IDs are fixed so demo logins survive across
       serverless invocations. User-created data is ephemeral on Vercel. */
    dir = "/tmp/relia-data";
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, "reports"), { recursive: true });
  }

  const db = new DatabaseSync(path.join(dir, "relialedger.db"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  seed(db);
  ensureDemoAccessUsers(db);
  ensureModuleEntitlements(db);

  globalRef.__reliaDb = db;
  return db;
}

function ensureColumn(db: DatabaseSync, table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

/**
 * The login screen advertises a "username-test / password-test" account.
 * Seed it idempotently so that claim is true on both fresh and existing DBs.
 */
function ensureDemoAccessUsers(db: DatabaseSync) {
  const company = db.prepare("SELECT id FROM companies ORDER BY rowid LIMIT 1").get() as any;
  if (!company) return;
  db.prepare(
    `INSERT OR IGNORE INTO users (id, company_id, email, name, password_hash, role)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("u-username-test", company.id, "username-test", "Test User", hashPassword("password-test"), "employee");

  /* The testing login must actually be able to open the workspace. Without a
     project membership the access checks return no read rights and every
     module errors, even though sign-in succeeded. Give the test account a
     company-admin membership on the company's existing projects. */
  const projects = db.prepare("SELECT id FROM projects WHERE company_id = ?").all(company.id) as any[];
  for (const project of projects) {
    db.prepare(
      `INSERT OR IGNORE INTO project_members (project_id, user_id, role, module_grants)
       VALUES (?, ?, 'company_admin', '{}')`,
    ).run(project.id, "u-username-test");
  }
}

/**
 * New modules are added to every bundle over time. Existing projects keep
 * their licensed bundle but would otherwise be missing the new entitlement row,
 * so backfill anything the bundle contains that the project does not yet have.
 * Explicit disables are never re-enabled.
 */
function ensureModuleEntitlements(db: DatabaseSync) {
  /* Modules removed from the product must not linger in any project. */
  db.exec("DELETE FROM module_entitlements WHERE module_key NOT IN ('pbs','register','fmeca','pm','spares','safety','fta','rbd','reports')");
  db.exec("DELETE FROM fmea_rows WHERE kind = 'dfmea'");
  const projects = db.prepare("SELECT id, licensed_bundle FROM projects").all() as any[];
  const insert = db.prepare(
    "INSERT OR IGNORE INTO module_entitlements (project_id, module_key, enabled) VALUES (?, ?, 1)",
  );
  for (const project of projects) {
    for (const key of bundleModules(project.licensed_bundle)) insert.run(project.id, key);
  }
}

function migrate(db: DatabaseSync) {
  ensureColumn(db, "users", "password_hash", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "projects", "operating_hours", "REAL NOT NULL DEFAULT 8760");
  ensureColumn(db, "projects", "product_life_years", "REAL NOT NULL DEFAULT 10");
  ensureColumn(db, "fault_trees", "mission_hours", "REAL NOT NULL DEFAULT 8760");
  ensureColumn(db, "fault_tree_nodes", "gate_k", "INTEGER");
  ensureColumn(db, "rbd_blocks", "group_key", "TEXT NOT NULL DEFAULT 'stage-1'");
  ensureColumn(db, "rbd_blocks", "group_type", "TEXT NOT NULL DEFAULT 'series'");
  ensureColumn(db, "rbd_blocks", "group_k", "INTEGER");
  ensureColumn(db, "rbd_blocks", "group_n", "INTEGER");
  ensureColumn(db, "import_jobs", "detail", "TEXT");
ensureColumn(db, "fmea_rows", "priced_rev", "INTEGER");
}

/* ------------------------------------------------------------------ seed */

function iso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString();
}

function insert(db: DatabaseSync, table: string, values: Record<string, any>) {
  const keys = Object.keys(values);
  const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`;
  db.prepare(sql).run(
    ...keys.map((k) => {
      const v = values[k];
      if (v === undefined) return null;
      if (typeof v === "boolean") return v ? 1 : 0;
      return v;
    }),
  );
}

function seed(db: DatabaseSync) {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM companies").get() as any;
  if (existing.n > 0) return;

  const COMPANY = "co-northwind";
  const PROJECT = "prj-kestrel";
  const ADMIN = "u-maya";
  const REVIEWER = "u-tom";
  const ANALYST = "u-priya";
  const PASSWORD = "demo1234";

  const nodes: {
    id: string;
    parent: string | null;
    level: string;
    name: string;
    part?: string;
    qty?: number;
    category?: string;
    location?: string;
  }[] = [
    { id: "n-sys", parent: null, level: "system", name: "Kestrel-9 Flight Control System", part: "K9-FCS" },
    { id: "n-power", parent: "n-sys", level: "subsystem", name: "Electrical Power", part: "K9-PWR" },
    { id: "n-bat", parent: "n-power", level: "assembly", name: "Battery Pack", part: "K9-BAT" },
    { id: "n-bat-cell", parent: "n-bat", level: "component", name: "Li-ion cell pack", part: "BAT-48-9", category: "mechanical", location: "Equipment bay" },
    { id: "n-pdu", parent: "n-power", level: "assembly", name: "Power Distribution Unit", part: "K9-PDU" },
    { id: "n-pdu-mos", parent: "n-pdu", level: "component", name: "Power MOSFET switch", part: "IRF7749", qty: 6, category: "electronic", location: "PDU board" },
    { id: "n-pdu-cap", parent: "n-pdu", level: "component", name: "Bulk capacitor", part: "CAP-470", qty: 4, category: "electronic", location: "PDU board" },
    { id: "n-compute", parent: "n-sys", level: "subsystem", name: "Flight Computer", part: "K9-FCC" },
    { id: "n-fcc", parent: "n-compute", level: "assembly", name: "Flight Control Card", part: "K9-FCC-2" },
    { id: "n-mcu", parent: "n-fcc", level: "component", name: "Flight controller SoC", part: "SOC-X7", category: "electronic", location: "FCC slot A" },
    { id: "n-imu", parent: "n-fcc", level: "component", name: "Inertial measurement unit", part: "IMU-2000", category: "electronic", location: "FCC slot B" },
    { id: "n-io", parent: "n-compute", level: "assembly", name: "IO Harness", part: "K9-IO" },
    { id: "n-conn", parent: "n-io", level: "component", name: "Primary connector", part: "D38999", qty: 2, category: "electronic", location: "Bulkhead" },
    { id: "n-act", parent: "n-sys", level: "subsystem", name: "Actuation", part: "K9-ACT" },
    { id: "n-ail", parent: "n-act", level: "assembly", name: "Aileron Actuator", part: "K9-AA" },
    { id: "n-servo", parent: "n-ail", level: "component", name: "Servo motor", part: "SM-45", category: "mechanical", location: "Wing bay" },
    { id: "n-gearbox", parent: "n-ail", level: "component", name: "Planetary gearbox", part: "GB-12", category: "mechanical", location: "Wing bay" },
    { id: "n-elev", parent: "n-act", level: "assembly", name: "Elevator Actuator", part: "K9-EA" },
    { id: "n-servo2", parent: "n-elev", level: "component", name: "Servo motor (elevator)", part: "SM-45", category: "mechanical", location: "Tail bay" },
    { id: "n-comms", parent: "n-sys", level: "subsystem", name: "Comms & Navigation", part: "K9-NAV" },
    { id: "n-datalink", parent: "n-comms", level: "assembly", name: "Datalink", part: "K9-DL" },
    { id: "n-rf", parent: "n-datalink", level: "component", name: "RF transceiver", part: "RF-900", category: "electronic", location: "Avionics rack" },
    { id: "n-ant", parent: "n-datalink", level: "component", name: "Antenna", part: "ANT-2", category: "mechanical", location: "Fuselage" },
    { id: "n-gps", parent: "n-comms", level: "component", name: "GNSS receiver", part: "GNSS-5", category: "electronic", location: "Avionics rack" },
  ];

  const rates: Record<
    string,
    { lambda: number; method: string; part?: string; env?: string; quality?: string; factors?: Record<string, number>; source?: string }
  > = {
    "n-bat-cell": { lambda: 2.5e-6, method: "manual", source: "Fleet field data, 3 years / 12,400 h" },
    "n-pdu-mos": { lambda: 1.2e-6, method: "mil_217f", part: "transistor", env: "AUC", quality: "industrial", factors: { lambdaB: 0.00074, piT: 2.1, piA: 1.5, piR: 1.0, piS: 1.4 } },
    "n-pdu-cap": { lambda: 0.35e-6, method: "mil_217f", part: "capacitor_aluminium", env: "AUC", quality: "industrial", factors: { lambdaB: 0.00012, piT: 1.8, piV: 1.2, piS: 1.1 } },
    "n-mcu": { lambda: 8.0e-6, method: "mil_217f", part: "microcircuit", env: "AUC", quality: "industrial", factors: { lambdaB: 0.02, piT: 1.9, piV: 1.0, piL: 1.0 } },
    "n-imu": { lambda: 6.5e-6, method: "manual", source: "Supplier MTBF 153,800 h" },
    "n-conn": { lambda: 0.45e-6, method: "mil_217f", part: "connector", env: "AUC", quality: "mil", factors: { lambdaB: 0.00003, piT: 1.0, piC: 1.6 } },
    "n-servo": { lambda: 4.2e-6, method: "manual", source: "Supplier MTBF 238,000 h" },
    "n-gearbox": { lambda: 3.1e-6, method: "manual", source: "Supplier MTBF 322,000 h" },
    "n-servo2": { lambda: 4.2e-6, method: "manual", source: "Supplier MTBF 238,000 h" },
    "n-rf": { lambda: 5.5e-6, method: "manual", source: "Supplier MTBF 181,800 h" },
    "n-ant": { lambda: 0.8e-6, method: "manual", source: "Supplier MTBF 1,250,000 h" },
    "n-gps": { lambda: 3.0e-6, method: "manual", source: "Supplier MTBF 333,000 h" },
  };

  const components = nodes.filter((n) => n.level === "component");
  const depthOf = (id: string): number => {
    let depth = 0;
    let cursor = nodes.find((n) => n.id === id);
    while (cursor?.parent) {
      depth++;
      cursor = nodes.find((n) => n.id === cursor!.parent);
    }
    return depth;
  };

  db.exec("BEGIN");
  try {
    insert(db, "companies", { id: COMPANY, name: "Northwind Aerospace", plan: "standard" });

    insert(db, "users", { id: ADMIN, company_id: COMPANY, email: "admin@relialedger.app", name: "Maya Iyer", password_hash: hashPassword(PASSWORD), role: "company_admin" });
    insert(db, "users", { id: REVIEWER, company_id: COMPANY, email: "reviewer@relialedger.app", name: "Tom Beckett", password_hash: hashPassword(PASSWORD), role: "reviewer" });
    insert(db, "users", { id: ANALYST, company_id: COMPANY, email: "analyst@relialedger.app", name: "Priya Raman", password_hash: hashPassword(PASSWORD), role: "employee" });

    insert(db, "projects", {
      id: PROJECT,
      company_id: COMPANY,
      name: "Kestrel-9 Flight Control",
      code: "K9-FCS",
      customer: "Northwind Aerospace",
      timezone: "UTC",
      licensed_bundle: "full_suite",
      mission_hours: 8760,
      operating_hours: 8760,
      product_life_years: 10,
      rev: 0,
      created_at: iso(120),
    });

    insert(db, "project_members", { project_id: PROJECT, user_id: ADMIN, role: "company_admin", module_grants: "{}" });
    insert(db, "project_members", { project_id: PROJECT, user_id: REVIEWER, role: "reviewer", module_grants: "{}" });
    insert(db, "project_members", {
      project_id: PROJECT,
      user_id: ANALYST,
      role: "employee",
      module_grants: JSON.stringify({ pbs: "write", register: "write", fmeca: "write", reports: "write", pm: "read", spares: "read", safety: "read", fta: "read", rbd: "read" }),
    });

    for (const key of bundleModules("full_suite")) {
      insert(db, "module_entitlements", { project_id: PROJECT, module_key: key, enabled: 1 });
    }

    nodes.forEach((n, i) => {
      insert(db, "pbs_nodes", {
        id: n.id,
        project_id: PROJECT,
        parent_id: n.parent,
        level: n.level,
        name: n.name,
        part_number: n.part ?? null,
        quantity: n.qty ?? 1,
        category: n.category ?? (n.level === "component" ? "other" : "other"),
        location: n.location ?? null,
        depth: depthOf(n.id),
        sort_order: i,
      });
    });

    for (const [nodeId, r] of Object.entries(rates)) {
      insert(db, "failure_rates", {
        pbs_node_id: nodeId,
        project_id: PROJECT,
        method: r.method,
        lambda_per_hour: r.lambda,
        environment: r.env ?? null,
        quality: r.quality ?? null,
        part_type: r.part ?? null,
        factors: JSON.stringify(r.factors ?? {}),
        source_ref: r.source ?? null,
        calculated_at: r.method === "mil_217f" ? iso(20) : null,
      });
    }

    /* MTTR — one record and four phases for every component */
    for (const component of components) {
      const recordId = `mttr-${component.id}`;
      const heavy = component.category === "mechanical";
      insert(db, "mttr_records", {
        id: recordId,
        project_id: PROJECT,
        pbs_node_id: component.id,
        repair_location: heavy ? "Forward equipment bay" : "Avionics rack",
        manpower: heavy ? 2 : 1,
        spares_available: component.id === "n-gearbox" ? 0 : 1,
      });
      const steps = [
        { phase: "detect", description: "Fault annunciated by BIT / crew report", minutes: heavy ? 20 : 10 },
        { phase: "diagnose", description: "Isolate to LRU with maintenance computer", minutes: heavy ? 35 : 20 },
        { phase: "repair", description: heavy ? "Remove and replace actuator assembly" : "Remove and replace line replaceable unit", minutes: heavy ? 120 : 45 },
        { phase: "verify", description: "Built-in test and functional check", minutes: 20 },
      ];
      steps.forEach((s, i) => {
        insert(db, "mttr_steps", {
          id: `step-${component.id}-${i}`,
          project_id: PROJECT,
          mttr_record_id: recordId,
          phase: s.phase,
          description: s.description,
          minutes: s.minutes,
          sort_order: i,
        });
      });
    }

    /* FMECA — derived numbers recomputed below */
    const fmeca: [string, string, string, string, string, number, number][] = [
      ["n-mcu", "Loss of compute output", "Single-event upset / latch-up", "No actuator commands", "Loss of flight control", 0.6, 1.0],
      ["n-mcu", "Timing drift beyond tolerance", "Clock oscillator degradation", "Control loop instability", "Loss of flight control", 0.4, 0.5],
      ["n-imu", "Gyro bias out of tolerance", "MEMS drift over temperature", "Attitude error", "Degraded control authority", 0.7, 0.3],
      ["n-servo", "Actuator jam", "Gear train contamination", "Aileron frozen", "Loss of roll control", 0.8, 1.0],
      ["n-gearbox", "Gear tooth fracture", "Fatigue at tooth root", "Actuator lock", "Loss of roll control", 0.5, 1.0],
      ["n-bat-cell", "Cell thermal runaway", "Internal short after impact", "Power bus loss", "Loss of flight control", 0.2, 1.0],
      ["n-pdu-mos", "Switch short circuit", "Gate oxide breakdown", "Bus overvoltage", "Loss of avionics", 0.6, 0.7],
      ["n-rf", "Loss of datalink", "Antenna feeder corrosion", "No ground command", "Mission abort", 0.9, 0.3],
      ["n-gps", "Loss of GNSS fix", "Constellation geometry / jamming", "Navigation degraded", "Mission abort", 0.8, 0.2],
      ["n-servo2", "Elevator actuator jam", "Bearing seizure", "Elevator frozen", "Loss of pitch control", 0.8, 1.0],
    ];
    fmeca.forEach(([node, mode, cause, local, end, alpha, beta], i) => {
      insert(db, "fmea_rows", {
        id: `fm-${i + 1}`,
        project_id: PROJECT,
        pbs_node_id: node,
        kind: "fmeca",
        failure_mode: mode,
        cause,
        local_effect: local,
        system_effect: local,
        end_effect: end,
        alpha,
        beta,
        mission_t: 87600,
        action: i < 3 ? "Add monitoring and a defined dispatch limit" : null,
        action_owner: i < 3 ? "Maya Iyer" : null,
      });
    });

    /* PM */
    const pm: [string, string, string, number, string, number][] = [
      ["n-servo", "Actuator strip-down and re-grease", "time", 400, "hours", 45],
      ["n-gearbox", "Gearbox oil debris analysis", "condition", 90, "days", 20],
      ["n-bat-cell", "Battery capacity and balance check", "time", 180, "days", 60],
      ["n-mcu", "Firmware integrity and BIT review", "time", 30, "days", 5],
      ["n-rf", "Datalink RF power and VSWR check", "time", 90, "days", 30],
      ["n-conn", "Connector inspection and reseat", "time", 365, "days", 200],
    ];
    pm.forEach(([node, description, strategy, value, unit, lastDays], i) => {
      insert(db, "maintenance_tasks", {
        id: `pm-${i + 1}`,
        project_id: PROJECT,
        pbs_node_id: node,
        description,
        strategy,
        interval_value: value,
        interval_unit: unit,
        manpower: 2,
        last_done_at: iso(lastDays),
      });
    });

    /* Spares */
    const spares: [string, number, number, number, number, number][] = [
      ["n-bat-cell", 1, 45, 1, 185000, 0.95],
      ["n-pdu-mos", 12, 30, 10, 4200, 0.95],
      ["n-pdu-cap", 8, 21, 10, 1800, 0.9],
      ["n-mcu", 2, 120, 1, 245000, 0.98],
      ["n-imu", 1, 90, 1, 320000, 0.95],
      ["n-servo", 3, 60, 1, 145000, 0.95],
      ["n-gearbox", 0, 150, 1, 480000, 0.98],
      ["n-rf", 2, 75, 1, 96000, 0.9],
    ];
    spares.forEach(([node, onHand, lead, moq, cost, service], i) => {
      insert(db, "spare_items", {
        id: `sp-${i + 1}`,
        project_id: PROJECT,
        pbs_node_id: node,
        qty_on_hand: onHand,
        lead_time_days: lead,
        moq,
        unit_cost_cents: cost,
        service_level: service,
      });
    });

    /* Safety */
    const hazards: [string, string | null, number, number, number | null, number | null, any[]][] = [
      ["Loss of flight control after power bus failure", "n-pdu", 4, 3, 4, 1, [{ level: "Design", control: "Redundant power bus and isolation diodes", verified_at: iso(80) }]],
      ["Battery thermal runaway in the equipment bay", "n-bat-cell", 4, 2, 4, 1, [{ level: "Design", control: "Cell-level fusing and vent path", verified_at: iso(70) }, { level: "Procedure", control: "Pre-flight cell balance check", verified_at: iso(14) }]],
      ["Uncommanded actuator movement on the ground", "n-servo", 4, 3, 3, 2, [{ level: "Design", control: "Arming interlock in the actuator driver", verified_at: iso(60) }]],
      ["Loss of datalink during approach", "n-rf", 3, 4, 3, 2, [{ level: "Design", control: "Independent return-to-base autonomy", verified_at: iso(100) }]],
      ["GNSS spoofing corrupts navigation solution", "n-gps", 3, 3, 3, 2, [{ level: "Detection", control: "Receiver autonomous integrity monitoring", verified_at: null }]],
      ["Single FCC channel failure with monitoring inhibited", "n-mcu", 4, 4, 4, 2, [{ level: "Design", control: "Independent channel monitor", verified_at: null }]],
    ];
    hazards.forEach(([description, node, s, l, rs, rl, controls], i) => {
      insert(db, "hazards", {
        id: `hz-${i + 1}`,
        project_id: PROJECT,
        pbs_node_id: node,
        description,
        severity: s,
        likelihood: l,
        residual_severity: rs,
        residual_likelihood: rl,
        controls: JSON.stringify(controls),
      });
    });

    /* Fault tree */
    const TREE = "ft-kestrel";
    insert(db, "fault_trees", {
      id: TREE,
      project_id: PROJECT,
      name: "Loss of flight control",
      top_label: "Loss of flight control",
      mission_hours: 8760,
    });
    const fta: [string, string | null, string, string | null, string | null, number | null, string, number][] = [
      ["ft-root", null, "gate", "or", null, null, "Loss of flight control", 0],
      ["ft-power", "ft-root", "gate", "or", null, null, "Loss of electrical power", 0],
      ["ft-bat", "ft-power", "event", null, "n-bat-cell", null, "Battery pack failure", 0],
      ["ft-pdu", "ft-power", "event", null, "n-pdu-mos", null, "PDU switch failure", 1],
      ["ft-compute", "ft-root", "gate", "or", null, null, "Loss of flight computer", 1],
      ["ft-mcu", "ft-compute", "event", null, "n-mcu", null, "Flight controller SoC failure", 0],
      ["ft-imu", "ft-compute", "event", null, "n-imu", null, "IMU failure", 1],
      ["ft-vote", "ft-root", "gate", "voting", null, 2, "Two of three sensor channels invalid", 2],
      ["ft-v1", "ft-vote", "event", null, "n-mcu", null, "Channel 1 invalid", 0],
      ["ft-v2", "ft-vote", "event", null, "n-imu", null, "Channel 2 invalid", 1],
      ["ft-v3", "ft-vote", "event", null, "n-gps", null, "Channel 3 invalid", 2],
      ["ft-act", "ft-root", "gate", "and", null, null, "Dual actuator jam", 3],
      ["ft-servo", "ft-act", "event", null, "n-servo", null, "Aileron actuator jam", 0],
      ["ft-servo2", "ft-act", "event", null, "n-servo2", null, "Elevator actuator jam", 1],
    ];
    fta.forEach(([id, parent, type, gate, node, k, label, sort]) => {
      insert(db, "fault_tree_nodes", {
        id,
        project_id: PROJECT,
        tree_id: TREE,
        parent_id: parent,
        node_type: type,
        gate_type: gate,
        gate_k: k,
        pbs_node_id: node,
        label,
        sort_order: sort,
      });
    });

    /* RBD */
    const MODEL = "rbd-kestrel";
    insert(db, "rbd_models", {
      id: MODEL,
      project_id: PROJECT,
      name: "Flight control chain",
      mission_hours: 8760,
    });
    const mission = 8760;
    const rbd: [string, string, string, string, number | null, string][] = [
      ["rb-bat", "n-bat-cell", "Battery pack", "power", null, "series"],
      ["rb-pdu", "n-pdu-mos", "Power distribution", "power", null, "series"],
      ["rb-fcc-a", "n-mcu", "FCC path A", "compute", null, "parallel"],
      ["rb-fcc-b", "n-imu", "FCC path B", "compute", null, "parallel"],
      ["rb-servo", "n-servo", "Aileron actuator", "actuation", 1, "k_out_of_n"],
      ["rb-servo2", "n-servo2", "Elevator actuator", "actuation", 1, "k_out_of_n"],
      ["rb-rf", "n-rf", "Datalink", "datalink", null, "series"],
    ];
    rbd.forEach(([id, node, label, group, k, type], i) => {
      const lambda = rates[node]?.lambda ?? 0;
      insert(db, "rbd_blocks", {
        id,
        project_id: PROJECT,
        model_id: MODEL,
        pbs_node_id: node,
        label,
        reliability: reliability(lambda, mission),
        group_key: group,
        group_type: type,
        group_k: k,
        group_n: type === "k_out_of_n" ? 2 : null,
        sort_order: i,
      });
    });

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const summary = recomputeProject(db, PROJECT);

  /* One frozen baseline report so the Output module is not empty on first run */
  const modules = ["pbs", "register", "fmeca", "spares", "safety"];
  const snapshot = snapshotProject(db, PROJECT, modules);
  const versionId = `ver-${randomUUID()}`;
  const reportId = `rep-${randomUUID()}`;
  insert(db, "analysis_versions", {
    id: versionId,
    project_id: PROJECT,
    rev: summary.rev,
    label: "Baseline review",
    snapshot: JSON.stringify(snapshot),
    created_by: ADMIN,
    created_at: iso(7),
  });
  insert(db, "reports", {
    id: reportId,
    project_id: PROJECT,
    version_id: versionId,
    modules: JSON.stringify(modules),
    filters: "{}",
    format: "xlsx",
    status: "ready",
    file_name: `Kestrel-9-flight-control-baseline-rev${summary.rev}.xlsx`,
    revision: 1,
    generated_by: ADMIN,
    generated_at: iso(7),
  });

  insert(db, "audit_events", {
    company_id: COMPANY,
    project_id: PROJECT,
    actor_id: ADMIN,
    entity: "project",
    entity_id: PROJECT,
    action: "create",
    detail: "Created Kestrel-9 Flight Control with the Full Suite bundle",
    at: iso(120),
  });
  insert(db, "audit_events", {
    company_id: COMPANY,
    project_id: PROJECT,
    actor_id: ANALYST,
    entity: "failure_rate",
    entity_id: "n-mcu",
    action: "update",
    detail: "λ set to 8.000 FPMH using MIL-HDBK-217F part stress",
    at: iso(21),
  });
  insert(db, "audit_events", {
    company_id: COMPANY,
    project_id: PROJECT,
    actor_id: ADMIN,
    entity: "report",
    entity_id: reportId,
    action: "export",
    detail: "Baseline review generated from a frozen snapshot",
    at: iso(7),
  });
}
