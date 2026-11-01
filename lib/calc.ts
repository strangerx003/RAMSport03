/**
 * RAMSport03 calculation engine.
 *
 * Pure functions only: the same code runs on the server (authoritative recompute)
 * and in the browser (instant previews). No imports, no side effects.
 *
 * Units: every failure rate is stored and returned as failures per operating HOUR.
 * The UI converts to failures FPMH (failures per million hours) for display only.
 */

export const HOURS_PER_YEAR = 8760;

/* ------------------------------------------------------------------ Rates / MIL-HDBK-217F */

/**
 * MIL-HDBK-217F environmental factor πE.
 * Values are the published table values; the part-stress form applies them
 * multiplicatively exactly as the handbook's part models do.
 */
export const PI_E: Record<string, { label: string; value: number }> = {
  GB: { label: "GB — Ground, benign", value: 1.0 },
  GF: { label: "GF — Ground, fixed", value: 2.0 },
  GM: { label: "GM — Ground, mobile", value: 4.0 },
  NS: { label: "NS — Naval, sheltered", value: 6.0 },
  NU: { label: "NU — Naval, unsheltered", value: 9.0 },
  AIC: { label: "AIC — Airborne, inhabited cargo", value: 6.0 },
  AIF: { label: "AIF — Airborne, inhabited fighter", value: 8.0 },
  AUC: { label: "AUC — Airborne, uninhabited cargo", value: 12.0 },
  AUF: { label: "AUF — Airborne, uninhabited fighter", value: 16.0 },
  ARW: { label: "ARW — Airborne, rotary wing", value: 24.0 },
  SF: { label: "SF — Space, flight", value: 0.5 },
  MF: { label: "MF — Missile, flight", value: 12.0 },
  ML: { label: "ML — Missile, launch", value: 16.0 },
  CL: { label: "CL — Cannon launch", value: 14.0 },
};

export const QUALITY: { key: string; label: string; piQ: number }[] = [
  { key: "space", label: "Space / S-level", piQ: 0.5 },
  { key: "mil", label: "MIL / JANTX screened", piQ: 1.0 },
  { key: "industrial", label: "Industrial", piQ: 1.5 },
  { key: "commercial", label: "Commercial", piQ: 3.0 },
  { key: "lower", label: "Lower / unqualified", piQ: 10.0 },
];

export type FactorKey = "piT" | "piP" | "piS" | "piV" | "piC" | "piL" | "piA" | "piR" | "piF" | "piCYC";

export const FACTOR_META: Record<FactorKey, string> = {
  piT: "πT — temperature",
  piP: "πP — power",
  piS: "πS — electrical stress",
  piV: "πV — voltage",
  piC: "πC — contact / construction",
  piL: "πL — learning / maturity",
  piA: "πA — application",
  piR: "πR — power rating",
  piF: "πF — cycling frequency",
  piCYC: "πCYC — cycling",
};

export type PartFamily = {
  key: string;
  name: string;
  group: "electronic" | "mechanical";
  /** Reference base failure rate, failures FPMH (failures per million hours). Editable in the form. */
  lambdaB: number;
  factors: FactorKey[];
};

/**
 * A deliberately small, open reference library. The full MIL-HDBK-217F part
 * catalogue is licensed material, so every base rate and every π factor here is
 * editable and shown in the calculation. Certified work should use the values
 * from the controlled copy of the handbook.
 */
export const PART_FAMILIES: PartFamily[] = [
  { key: "resistor_fixed", name: "Resistor, fixed", group: "electronic", lambdaB: 0.0025, factors: ["piT", "piP", "piS"] },
  { key: "resistor_variable", name: "Resistor, variable", group: "electronic", lambdaB: 0.0078, factors: ["piT", "piP", "piS"] },
  { key: "capacitor_ceramic", name: "Capacitor, ceramic", group: "electronic", lambdaB: 0.00016, factors: ["piT", "piV", "piS"] },
  { key: "capacitor_tantalum", name: "Capacitor, tantalum", group: "electronic", lambdaB: 0.0002, factors: ["piT", "piV", "piS"] },
  { key: "capacitor_aluminium", name: "Capacitor, aluminium", group: "electronic", lambdaB: 0.00012, factors: ["piT", "piV", "piS"] },
  { key: "microcircuit", name: "Microcircuit, monolithic", group: "electronic", lambdaB: 0.02, factors: ["piT", "piV", "piL"] },
  { key: "transistor", name: "Transistor", group: "electronic", lambdaB: 0.00074, factors: ["piT", "piA", "piR", "piS"] },
  { key: "diode", name: "Diode", group: "electronic", lambdaB: 0.00002, factors: ["piT", "piS", "piC"] },
  { key: "inductor", name: "Inductor", group: "electronic", lambdaB: 0.00003, factors: ["piT", "piC"] },
  { key: "relay", name: "Relay", group: "electronic", lambdaB: 0.0055, factors: ["piT", "piC", "piCYC", "piF"] },
  { key: "connector", name: "Connector", group: "electronic", lambdaB: 0.00003, factors: ["piT", "piC"] },
  { key: "crystal", name: "Crystal / oscillator", group: "electronic", lambdaB: 0.0006, factors: ["piT", "piC"] },
  { key: "pcb", name: "Printed circuit board", group: "electronic", lambdaB: 0.00007, factors: ["piT", "piC"] },
  { key: "solder_joint", name: "Solder joint", group: "electronic", lambdaB: 0.0000007, factors: ["piT", "piC"] },
  { key: "fan", name: "Fan / blower", group: "mechanical", lambdaB: 0.001, factors: ["piT", "piC"] },
  { key: "pump", name: "Hydraulic pump", group: "mechanical", lambdaB: 0.008, factors: ["piT", "piC"] },
  { key: "valve", name: "Valve", group: "mechanical", lambdaB: 0.001, factors: ["piT", "piC"] },
  { key: "motor", name: "Electric motor", group: "mechanical", lambdaB: 0.0012, factors: ["piT", "piC"] },
  { key: "battery", name: "Battery cell", group: "mechanical", lambdaB: 0.0003, factors: ["piT", "piC"] },
  { key: "actuator", name: "Actuator", group: "mechanical", lambdaB: 0.002, factors: ["piT", "piC"] },
  { key: "bearing", name: "Bearing", group: "mechanical", lambdaB: 0.0005, factors: ["piT", "piC"] },
];

export const PART_BY_KEY: Record<string, PartFamily> = Object.fromEntries(
  PART_FAMILIES.map((p) => [p.key, p]),
);

export type MilInput = {
  lambdaB: number; // FPMH (failures per million hours)
  piQ: number;
  piE: number;
  factors: Partial<Record<FactorKey, number>>;
};

/** λp per HOUR. */
export function milLambda(input: MilInput): number {
  let product = (input.piQ || 1) * (input.piE || 1);
  for (const v of Object.values(input.factors || {})) {
    product *= Number.isFinite(v) && (v as number) > 0 ? (v as number) : 1;
  }
  const perMillion = (input.lambdaB || 0) * product;
  return perMillion * 1e-6;
}

export function mtbf(lambdaPerHour: number): number | null {
  if (!Number.isFinite(lambdaPerHour) || lambdaPerHour <= 0) return null;
  return 1 / lambdaPerHour;
}

export function reliability(lambdaPerHour: number, hours: number): number {
  if (!Number.isFinite(lambdaPerHour) || lambdaPerHour <= 0) return 1;
  return Math.exp(-lambdaPerHour * Math.max(hours, 0));
}

export function unreliability(lambdaPerHour: number, hours: number): number {
  return 1 - reliability(lambdaPerHour, hours);
}

export function availability(mtbfHours: number | null, mttrHoursValue: number | null): number | null {
  if (mtbfHours == null || mttrHoursValue == null) return null;
  const total = mtbfHours + mttrHoursValue;
  if (total <= 0) return null;
  return mtbfHours / total;
}

/* ------------------------------------------------------------------ MTTR */

export const REPAIR_PENALTY_HOURS = 8;

export function mttrHours(
  steps: { minutes: number }[],
  manpower: number,
  sparesAvailable: boolean,
  sparesDelayHours = REPAIR_PENALTY_HOURS,
): number {
  const totalMinutes = steps.reduce((sum, s) => sum + (Number.isFinite(s.minutes) ? s.minutes : 0), 0);
  const elapsed = totalMinutes / Math.max(1, manpower || 1) / 60;
  return elapsed + (sparesAvailable ? 0 : sparesDelayHours);
}

/** λ-weighted roll-up; falls back to a plain mean when no weights are usable. */
export function weightedMean(
  values: { value: number; weight: number }[],
): number | null {
  const usable = values.filter((v) => Number.isFinite(v.value));
  if (!usable.length) return null;
  const totalWeight = usable.reduce((s, v) => s + (Number.isFinite(v.weight) ? v.weight : 0), 0);
  if (totalWeight <= 0) {
    return usable.reduce((s, v) => s + v.value, 0) / usable.length;
  }
  return usable.reduce((s, v) => s + v.value * v.weight, 0) / totalWeight;
}

/* ------------------------------------------------------------------ FMEA / FMECA */

export function rpn(severity: number, occurrence: number, detection: number): number {
  return (severity || 0) * (occurrence || 0) * (detection || 0);
}

/** MIL-STD-1629A mode criticality: Cm = β · α · λ · T */
export function criticality(beta: number, alpha: number, lambdaPerHour: number, missionHours: number): number {
  return (beta || 0) * (alpha || 0) * (lambdaPerHour || 0) * (missionHours || 0);
}

export function rankDescending<T extends { id: string; cm: number | null }>(rows: T[]): Map<string, number> {
  const sorted = [...rows].sort((a, b) => (b.cm ?? -1) - (a.cm ?? -1));
  const ranks = new Map<string, number>();
  sorted.forEach((row, i) => ranks.set(row.id, i + 1));
  return ranks;
}

/* ------------------------------------------------------------------ spares */

export function poissonPmf(k: number, mu: number): number {
  if (mu <= 0) return k === 0 ? 1 : 0;
  let logp = -mu + k * Math.log(mu);
  for (let i = 2; i <= k; i++) logp -= Math.log(i);
  return Math.exp(logp);
}

export function poissonCdf(k: number, mu: number): number {
  if (k < 0) return 0;
  if (mu <= 0) return 1;
  if (mu > 170) {
    // normal approximation with continuity correction
    const z = (k + 0.5 - mu) / Math.sqrt(mu);
    return normalCdf(z);
  }
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += poissonPmf(i, mu);
  return Math.min(1, sum);
}

/** Smallest k with P(X ≤ k) ≥ p. Capped for sanity. */
export function poissonQuantile(mu: number, p: number): number {
  if (mu <= 0) return 0;
  const target = Math.min(Math.max(p, 0.5), 0.999999);
  if (mu > 170) {
    return Math.max(0, Math.ceil(mu + normalQuantile(target) * Math.sqrt(mu)));
  }
  let sum = 0;
  for (let k = 0; k <= Math.max(50, Math.ceil(mu * 4) + 20); k++) {
    sum += poissonPmf(k, mu);
    if (sum >= target) return k;
  }
  return Math.max(0, Math.ceil(mu + 4 * Math.sqrt(mu) + 4));
}

export function normalPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

export function normalCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26 via erf approximation
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Inverse normal CDF (Acklam), accurate to ~1e-9 in the useful range. */
export function normalQuantile(p: number): number {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export type SparesInput = {
  lambdaPerHour: number;
  operatingHoursPerYear: number;
  leadTimeDays: number;
  serviceLevel: number;
  quantity?: number;
};

export type SparesResult = {
  annualDemand: number;
  demandDuringLead: number;
  safetyStock: number;
  reorderPoint: number;
  recommendedQty: number;
  orderUpTo: number;
  expectedStockouts: number;
  fillRate: number;
};

export function sparesModel(input: SparesInput): SparesResult {
  const qty = Math.max(1, input.quantity ?? 1);
  const annualDemand = Math.max(0, input.lambdaPerHour) * Math.max(0, input.operatingHoursPerYear) * qty;
  const leadYears = Math.max(0, input.leadTimeDays) / 365;
  const demandDuringLead = annualDemand * leadYears;
  const z = normalQuantile(Math.min(Math.max(input.serviceLevel || 0.95, 0.5), 0.9999));
  const sigma = Math.sqrt(Math.max(demandDuringLead, 0));
  const safetyStock = Math.max(0, Math.ceil(z * sigma));
  const reorderPoint = Math.max(0, Math.ceil(demandDuringLead + safetyStock));
  const recommendedQty = Math.max(0, poissonQuantile(demandDuringLead, input.serviceLevel || 0.95));
  const orderUpTo = Math.max(reorderPoint, recommendedQty);
  // expected shortage for a reorder point of R
  const mu = demandDuringLead;
  let expected = 0;
  if (mu > 0) {
    const start = Math.floor(reorderPoint);
    for (let k = start; k < start + 60; k++) {
      expected += (k - reorderPoint) * poissonPmf(k, mu);
    }
    expected += (start + 60 - reorderPoint) * Math.max(0, 1 - poissonCdf(start + 59, mu));
  }
  const fillRate = annualDemand > 0 ? Math.max(0, 1 - (expected * (365 / Math.max(1, input.leadTimeDays))) / annualDemand) : 1;
  return {
    annualDemand,
    demandDuringLead,
    safetyStock,
    reorderPoint,
    recommendedQty,
    orderUpTo,
    expectedStockouts: expected,
    fillRate,
  };
}

/* ------------------------------------------------------------------ safety */

export const SEVERITY_LABEL: Record<number, string> = {
  1: "Negligible",
  2: "Marginal",
  3: "Critical",
  4: "Catastrophic",
};

export const LIKELIHOOD_LABEL: Record<number, string> = {
  1: "Improbable",
  2: "Remote",
  3: "Occasional",
  4: "Probable",
  5: "Frequent",
};

export type Alarp = "acceptable" | "alarp" | "unacceptable";

export function riskScore(severity: number, likelihood: number): number {
  return (severity || 0) * (likelihood || 0);
}

export function riskBand(score: number): "low" | "medium" | "high" | "critical" {
  if (score >= 16) return "critical";
  if (score >= 10) return "high";
  if (score >= 5) return "medium";
  return "low";
}

export function alarp(severity: number, likelihood: number): Alarp {
  const score = riskScore(severity, likelihood);
  if (!severity || !likelihood) return "unacceptable";
  if (score >= 12 || (severity === 4 && likelihood >= 3)) return "unacceptable";
  if (score <= 4 && severity <= 2) return "acceptable";
  return "alarp";
}

/* ------------------------------------------------------------------ FTA */

export type FtaNodeRow = {
  id: string;
  parent_id: string | null;
  node_type: "event" | "gate";
  gate_type: "and" | "or" | "voting" | null;
  gate_k: number | null;
  pbs_node_id: string | null;
  label: string;
  probability: number | null;
  sort_order: number;
};

export type FtaResult = {
  ok: boolean;
  q: number | null;
  perNode: Record<string, number>;
  minimalCutSets: string[][];
  truncated: boolean;
  errors: string[];
  rootId: string | null;
};

export function basicEventProbability(node: FtaNodeRow, lambdaPerHour: number | null, missionHours: number): number {
  if (node.probability != null && Number.isFinite(node.probability)) return clamp01(node.probability);
  if (lambdaPerHour != null && lambdaPerHour >= 0) return unreliability(lambdaPerHour, missionHours);
  return 0;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/** Probability of at least k successes from independent children with these probs. */
export function atLeastK(probs: number[], k: number): number {
  const n = probs.length;
  if (k <= 0) return 1;
  if (k > n) return 0;
  let dp = new Array(n + 1).fill(0);
  dp[0] = 1;
  for (const p of probs) {
    const next = new Array(n + 1).fill(0);
    const q = 1 - clamp01(p);
    for (let i = 0; i <= n; i++) {
      if (!dp[i]) continue;
      next[i] += dp[i] * q;
      if (i + 1 <= n) next[i + 1] += dp[i] * clamp01(p);
    }
    dp = next;
  }
  let sum = 0;
  for (let i = k; i <= n; i++) sum += dp[i];
  return clamp01(sum);
}

const MAX_CUT_SETS = 5000;

export function computeFta(
  nodes: FtaNodeRow[],
  lambdaByNode: Record<string, number | null>,
  missionHours: number,
): FtaResult {
  const errors: string[] = [];
  const perNode: Record<string, number> = {};
  let truncated = false;

  if (!nodes.length) {
    return { ok: false, q: null, perNode, minimalCutSets: [], truncated, errors: ["The tree is empty."], rootId: null };
  }

  const byParent = new Map<string | null, FtaNodeRow[]>();
  for (const n of nodes) {
    const key = n.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(n);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.sort_order - b.sort_order);

  const roots = (byParent.get(null) ?? []).filter((n) => n.node_type === "gate" || n.node_type === "event");
  if (roots.length === 0) {
    return { ok: false, q: null, perNode, minimalCutSets: [], truncated, errors: ["No root node. Add a top event."], rootId: null };
  }
  if (roots.length > 1) errors.push(`${roots.length} root nodes found; computing the first one only.`);

  const root = roots[0];
  const seen = new Set<string>();

  const evalNode = (node: FtaNodeRow): number => {
    if (seen.has(node.id)) {
      errors.push("Cycle detected in the fault tree.");
      return 0;
    }
    seen.add(node.id);
    const lambda = node.pbs_node_id ? lambdaByNode[node.pbs_node_id] ?? null : null;

    if (node.node_type === "event") {
      const p = basicEventProbability(node, lambda, missionHours);
      perNode[node.id] = p;
      seen.delete(node.id);
      return p;
    }

    const children = byParent.get(node.id) ?? [];
    if (!children.length) {
      errors.push(`Gate "${node.label || node.id}" has no children.`);
      perNode[node.id] = 0;
      seen.delete(node.id);
      return 0;
    }
    const childProbs = children.map(evalNode);
    let value = 0;
    switch (node.gate_type) {
      case "and":
        value = childProbs.reduce((a, b) => a * b, 1);
        break;
      case "or":
        value = 1 - childProbs.reduce((a, b) => a * (1 - b), 1);
        break;
      case "voting":
        const k = Math.max(1, Math.min(node.gate_k ?? 2, children.length));
        value = atLeastK(childProbs, k);
        break;
      default:
        errors.push(`Gate "${node.label || node.id}" has no gate type.`);
        value = 0;
    }
    perNode[node.id] = clamp01(value);
    seen.delete(node.id);
    return clamp01(value);
  };

  const q = evalNode(root);

  /* ---- minimal cut sets (basic event labels / ids) ---- */
  const mcsSeen = new Set<string>();
  const cutCache = new Map<string, string[][]>();

  const cutSets = (node: FtaNodeRow, depth: number): string[][] => {
    if (depth > 64) {
      truncated = true;
      return [];
    }
    if (cutCache.has(node.id)) return cutCache.get(node.id)!;
    let result: string[][] = [];
    if (node.node_type === "event") {
      result = [[node.label || node.id]];
    } else {
      const children = byParent.get(node.id) ?? [];
      if (node.gate_type === "or") {
        for (const child of children) {
          result = result.concat(cutSets(child, depth + 1));
          if (result.length > MAX_CUT_SETS) {
            truncated = true;
            break;
          }
        }
      } else if (node.gate_type === "and") {
        result = [[]];
        for (const child of children) {
          const childSets = cutSets(child, depth + 1);
          if (!childSets.length) {
            result = [];
            break;
          }
          const next: string[][] = [];
          for (const a of result) {
            for (const b of childSets) {
              next.push(Array.from(new Set([...a, ...b])).sort());
              if (next.length > MAX_CUT_SETS) {
                truncated = true;
                break;
              }
            }
            if (truncated) break;
          }
          result = next;
          if (truncated) break;
        }
      } else if (node.gate_type === "voting") {
        const k = Math.max(1, Math.min(node.gate_k ?? children.length, children.length));
        const childSets = children.map((c) => cutSets(c, depth + 1));
        result = combinations(childSets, k).map((combo) => {
          const merged = new Set<string>();
          for (const set of combo) for (const id of set) merged.add(id);
          return Array.from(merged).sort();
        });
        if (result.length > MAX_CUT_SETS) {
          result = result.slice(0, MAX_CUT_SETS);
          truncated = true;
        }
      }
    }
    cutCache.set(node.id, result);
    return result;
  };

  let minimal: string[][] = [];
  try {
    const raw = cutSets(root, 0);
    minimal = minimiseCutSets(raw);
  } catch {
    truncated = true;
    errors.push("Cut-set enumeration exceeded the budget; Q(t) is still exact.");
  }
  for (const set of minimal) mcsSeen.add(set.join("|"));

  return { ok: errors.length === 0 || q != null, q, perNode, minimalCutSets: minimal, truncated, errors, rootId: root.id };
}

function combinations<T>(lists: T[][], k: number): T[][] {
  const out: T[][] = [];
  const indices: number[] = [];
  const walk = (start: number) => {
    if (out.length > MAX_CUT_SETS) return;
    if (indices.length === k) {
      out.push(indices.flatMap((i) => lists[i]));
      return;
    }
    for (let i = start; i < lists.length; i++) {
      if (!lists[i]?.length) continue;
      indices.push(i);
      walk(i + 1);
      indices.pop();
      if (out.length > MAX_CUT_SETS) return;
    }
  };
  walk(0);
  return out;
}

export function minimiseCutSets(sets: string[][]): string[][] {
  const unique = new Map<string, string[]>();
  for (const set of sets) {
    if (!set.length) continue;
    const key = [...set].sort().join("|");
    if (!unique.has(key)) unique.set(key, [...set].sort());
  }
  const sorted = [...unique.values()].sort((a, b) => a.length - b.length);
  const kept: string[][] = [];
  for (const set of sorted) {
    const keySet = new Set(set);
    const dominated = kept.some((existing) => existing.every((id) => keySet.has(id)));
    if (!dominated) kept.push(set);
  }
  return kept;
}

/* ------------------------------------------------------------------ RBD (IEC 61078) */

export type RbdBlockRow = {
  id: string;
  label: string;
  group_key: string;
  group_type: "series" | "parallel" | "k_out_of_n";
  group_k: number | null;
  group_n: number | null;
  reliability: number;
  sort_order: number;
  pbs_node_id: string | null;
};

export type RbdStageResult = {
  key: string;
  type: string;
  k: number | null;
  n: number;
  reliability: number;
  availability: number | null;
  blocks: ({ id: string; label: string; reliability: number; availability: number | null })[];
};

export type RbdResult = {
  stages: RbdStageResult[];
  rsys: number | null;
  availability: number | null;
  curve: { t: number; r: number }[];
};

export function stageReliability(probs: number[], type: string, k: number | null): number {
  if (!probs.length) return 1;
  if (type === "parallel") return clamp01(1 - probs.reduce((acc, p) => acc * (1 - clamp01(p)), 1));
  if (type === "k_out_of_n") return atLeastK(probs, Math.max(1, Math.min(k ?? Math.ceil(probs.length / 2), probs.length)));
  return probs.reduce((acc, p) => acc * clamp01(p), 1);
}

export function computeRbd(
  blocks: RbdBlockRow[],
  blockAvailability: Record<string, number | null>,
  missionHours: number,
): RbdResult {
  const order: string[] = [];
  const groups = new Map<string, RbdBlockRow[]>();
  for (const b of blocks) {
    const key = b.group_key || "main";
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(b);
  }
  for (const list of groups.values()) list.sort((a, b) => a.sort_order - b.sort_order);

  const stages: RbdStageResult[] = [];
  for (const key of order) {
    const list = groups.get(key)!;
    const type = list[0].group_type;
    const k = list[0].group_k;
    const rel = stageReliability(list.map((b) => b.reliability), type, k);
    const availProbs = list.map((b) => blockAvailability[b.id]);
    const avail = availProbs.every((a) => a == null)
      ? null
      : stageReliability(availProbs.map((a) => a ?? 0), type, k);
    stages.push({
      key,
      type,
      k,
      n: list.length,
      reliability: rel,
      availability: avail,
      blocks: list.map((b, i) => ({
        id: b.id,
        label: b.label,
        reliability: b.reliability,
        availability: availProbs[i],
      })),
    });
  }

  const rsys = stages.reduce((acc, s) => acc * s.reliability, 1);
  const availValues = stages.map((s) => s.availability);
  const availabilityValue = availValues.every((a) => a == null)
    ? null
    : availValues.reduce((acc, a) => acc * (a ?? 0), 1);

  const T = Math.max(missionHours, 1);
  const points = 24;
  const curve = Array.from({ length: points + 1 }, (_, i) => {
    const t = (T * i) / points;
    let r = 1;
    for (const stage of stages) {
      const probs = stage.blocks.map((b) => {
        // derive an effective λ that reproduces the entered mission reliability
        const p = Math.min(Math.max(b.reliability, 1e-12), 1);
        const lambda = -Math.log(p) / T;
        return Math.exp(-lambda * t);
      });
      r *= stageReliability(probs, stage.type, stage.k);
    }
    return { t, r };
  });

  return { stages, rsys, availability: availabilityValue, curve };
}

/* ------------------------------------------------------------------ roll-ups */

/** Series roll-up of failure rates for a hierarchy node. */
export function seriesLambda(lambdas: number[]): number {
  return lambdas.reduce((acc, l) => acc + (Number.isFinite(l) && l > 0 ? l : 0), 0);
}

export function formatEngineering(value: number | null | undefined, digits = 3): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e5 || abs < 1e-4) return value.toExponential(digits);
  return value.toFixed(digits);
}
