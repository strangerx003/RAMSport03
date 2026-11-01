/** Fault-tree gate arithmetic per IEC 61025:2006.
 *
 * Pure functions implementing the static gate formulas (§5.2–5.3),
 * dormant-failure models (§6), CCF beta-factor (§11), minimal cut-set
 * reduction (§7), and top-event probability combination (§8).
 */

export type FtaGateType =
  | "gate and"
  | "gate or"
  | "gate xor"
  | "gate not"
  | "gate vote"
  | "gate inhibit"
  | "gate nor"
  | "gate nand"
  | "gate pand"
  | "gate seq"
  | "gate spare";

export type FtaEventType = "basic" | "undeveloped" | "conditional" | "dormant" | "house" | "zero";

export type FtaCcfGroup = {
  id: string;
  members: string[];
  beta: number;
  justification?: string;
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Q(t) = 1 - e^(-λt) for a constant failure rate, non-repairable. */
export function basicEventProbability(lambda: number, missionTime: number) {
  const rate = Math.max(0, lambda);
  const time = Math.max(0, missionTime);
  return clamp01(1 - Math.exp(-rate * time));
}

/** Dormant (latent) failure probability: q ≈ λT/2, plus repair term if given. */
export function dormantEventProbability(lambda: number, testInterval: number, repairTime = 0) {
  const rate = Math.max(0, lambda);
  const interval = Math.max(0, testInterval);
  const repair = Math.max(0, repairTime);
  return clamp01(rate * interval / 2 + rate * repair);
}

/** Per-demand probability: q = 1 - (1-p)^n ≈ n*p for small np. */
export function perDemandProbability(p: number, demands: number) {
  const prob = Math.max(0, Math.min(1, p));
  const n = Math.max(0, demands);
  return clamp01(1 - Math.pow(1 - prob, n));
}

/** Beta-factor CCF expansion for a group of n identical channels, each q. */
export function ccfBetaFactor(q: number, beta: number, n: number) {
  const p = clamp01(q);
  const b = Math.max(0, Math.min(1, beta));
  const count = Math.max(1, n);
  const independent = Math.pow(1 - b, count) * Math.pow(p, count);
  const ccf = b * p;
  return clamp01(ccf + independent);
}

/** Probability that at least k of n independent inputs occur (Poisson-binomial). */
export function atLeastK(probabilities: number[], k: number) {
  const n = probabilities.length;
  if (k <= 0) return 1;
  if (k > n) return 0;
  let dp = new Array<number>(n + 1).fill(0);
  dp[0] = 1;
  for (const raw of probabilities) {
    const p = clamp01(raw);
    const next = new Array<number>(n + 1).fill(0);
    for (let i = 0; i <= n; i += 1) {
      if (!dp[i]) continue;
      next[i] += dp[i] * (1 - p);
      if (i + 1 <= n) next[i + 1] += dp[i] * p;
    }
    dp = next;
  }
  let sum = 0;
  for (let i = Math.max(0, Math.trunc(k)); i <= n; i += 1) sum += dp[i];
  return clamp01(sum);
}

/** Minimal cut sets via top-down MOCUS with absorption. Returns cut sets sorted by order. */
export function minimalCutSets(
  topGateId: string,
  gates: Map<string, { type: string; inputs: string[] }>,
  events: Set<string>,
): string[][] {
  const rows: string[][] = [[topGateId]];
  let changed = true;
  while (changed) {
    changed = false;
    const next: string[][] = [];
    for (const row of rows) {
      let expanded = false;
      for (const item of row) {
        const gate = gates.get(item);
        if (gate && !events.has(item)) {
          expanded = true;
          if (gate.type === "gate or") {
            for (const input of gate.inputs) next.push([...row.filter((x) => x !== item), input]);
          } else if (gate.type === "gate and") {
            // Cartesian product: replace the gate with all inputs combined
            const rest = row.filter((x) => x !== item);
            const combinations = cartesianProduct(gate.inputs.map((i) => [i]));
            for (const combo of combinations) next.push([...rest, ...combo]);
          } else {
            // Non-decomposable gate (vote, inhibit, dynamic, etc.): keep as-is
            next.push([...row]);
          }
          break;
        }
      }
      if (!expanded) next.push(row);
    }
    // Absorption: remove any row that is a superset of another
    const minimal: string[][] = [];
    for (const a of next) {
      const isSuperset = next.some(
        (b) => b !== a && b.every((item) => a.includes(item)) && b.length < a.length,
      );
      if (!isSuperset) minimal.push(a);
    }
    if (minimal.length !== rows.length) changed = true;
    rows.length = 0;
    rows.push(...minimal);
  }
  // Sort by order (length), then lexicographically
  rows.sort((a, b) => a.length - b.length || a.join(",").localeCompare(b.join(",")));
  return rows;
}

function cartesianProduct<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]];
  const first = arrays[0];
  const rest = cartesianProduct(arrays.slice(1));
  const result: T[][] = [];
  for (const item of first) {
    for (const combo of rest) result.push([item, ...combo]);
  }
  return result;
}

export type FtaGraphNode = {
  id: number;
  /** Present for a logic gate; omitted for an event. */
  gateType?: string;
  gateK?: number;
  label: string;
  /** Basic-event probability Q(t). Ignored for gates. */
  probability?: number;
};

export type FtaCutSet = {
  events: number[];
  labels: string[];
  probability: number;
  order: number;
};

/**
 * Minimal cut sets for the graph actually drawn on the canvas (IEC 61025 §7,
 * MOCUS). Fault-tree edges run cause → effect, so the inputs of a node are the
 * edges whose `to` is that node.
 *
 * An intermediate event that is driven by a gate is transparent: the gate's
 * cut sets replace the event. Coherent gates (AND, OR, VOTE, INHIBIT) are
 * expanded exactly; non-coherent/dynamic gates are reported as unsupported
 * rather than silently producing a wrong list.
 */
export function cutSetsFromGraph(
  nodes: FtaGraphNode[],
  edges: { from: number; to: number }[],
  rootId: number,
  maxCutSets = 256,
): { cutSets: FtaCutSet[]; truncated: boolean; unsupported: boolean } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const inputs = new Map<number, number[]>();
  for (const edge of edges) inputs.set(edge.to, [...(inputs.get(edge.to) ?? []), edge.from]);
  let truncated = false;
  let unsupported = false;

  const absorb = (sets: number[][]) => {
    const sorted = sets
      .map((set) => [...new Set(set)].sort((a, b) => a - b))
      .sort((a, b) => a.length - b.length || a.join(",").localeCompare(b.join(",")));
    const minimal: number[][] = [];
    for (const set of sorted) {
      if (minimal.some((kept) => kept.every((id) => set.includes(id)))) continue;
      minimal.push(set);
      if (minimal.length >= maxCutSets) {
        truncated = true;
        break;
      }
    }
    return minimal;
  };

  const combine = (left: number[][], right: number[][]) => {
    const result: number[][] = [];
    for (const first of left) for (const second of right) result.push([...first, ...second]);
    return result;
  };

  const expand = (id: number, visiting: Set<number>): number[][] => {
    if (visiting.has(id)) return [];
    const node = byId.get(id);
    if (!node) return [];
    const nextVisiting = new Set(visiting).add(id);
    const sources = inputs.get(id) ?? [];

    if (node.gateType) {
      const branches = sources.map((source) => expand(source, nextVisiting));
      if (!branches.length) return [];
      if (node.gateType === "gate and" || node.gateType === "gate inhibit") {
        return branches.reduce((product, branch) => combine(product, branch), [[]]);
      }
      if (node.gateType === "gate or") return branches.flat();
      if (node.gateType === "gate vote") {
        const k = Math.max(1, Math.min(sources.length, node.gateK ?? Math.ceil(sources.length / 2)));
        const andOf = (indexes: number[]) =>
          indexes.reduce<number[][]>((product, index) => combine(product, branches[index]), [[]]);
        const choose = (start: number, picked: number[]): number[][] => {
          if (picked.length === k) return andOf(picked);
          if (start >= branches.length) return [];
          const result: number[][] = [];
          for (let index = start; index < branches.length; index += 1) {
            result.push(...choose(index + 1, [...picked, index]));
          }
          return result;
        };
        return choose(0, []);
      }
      // NOR, NAND, XOR, NOT and the dynamic gates are not coherent
      // fault-tree gates; a plain minimal-cut-set list would be misleading.
      unsupported = true;
      return [];
    }

    // Event node: no cause means a basic-event leaf; an event driven by one
    // cause is a pass-through (intermediate event); several causes are ORed.
    if (sources.length === 0) return [[id]];
    if (sources.length === 1) return expand(sources[0], nextVisiting);
    return sources.flatMap((source) => expand(source, nextVisiting));
  };

  const cutSets = absorb(expand(rootId, new Set()))
    .map((events) => ({
      events,
      labels: events.map((id) => byId.get(id)?.label ?? `#${id}`),
      probability: events.reduce(
        (product, id) => product * clamp01(byId.get(id)?.probability ?? 0),
        1,
      ),
      order: events.length,
    }))
    .sort((first, second) => first.order - second.order || second.probability - first.probability);

  return { cutSets, truncated, unsupported };
}

/** Cut-set probability assuming independent basic events. */
export function cutSetProbability(cutSet: string[], eventProbs: Map<string, number>) {
  let p = 1;
  for (const id of cutSet) p *= clamp01(eventProbs.get(id) ?? 0);
  return clamp01(p);
}

/** Rare-event upper bound: Q_top ≤ Σ Q_j */
export function rareEventBound(cutSetProbabilities: number[]) {
  return clamp01(cutSetProbabilities.reduce((sum, p) => sum + p, 0));
}

/** Esary–Proschan approximation: Q_top ≈ 1 − Π(1 − Q_j) */
export function esaryProschan(cutSetProbabilities: number[]) {
  let product = 1;
  for (const p of cutSetProbabilities) product *= 1 - clamp01(p);
  return clamp01(1 - product);
}

/** Exact top-event probability by inclusion–exclusion over the cut sets
 * (IEC 61025 Annex B). Falls back to Esary–Proschan above 18 cut sets. */
export function exactDisjointing(cutSets: string[][], eventProbs: Map<string, number>) {
  const count = cutSets.length;
  if (!count) return { total: 0, disjointProbs: [] as number[] };
  const cutSetProbs = cutSets.map((set) => cutSetProbability(set, eventProbs));
  if (count > 18) {
    return { total: esaryProschan(cutSetProbs), disjointProbs: cutSetProbs, fallback: "esary" as const };
  }
  let total = 0;
  const limit = 2 ** count;
  for (let mask = 1; mask < limit; mask += 1) {
    let selected = 0;
    const union = new Set<string>();
    for (let index = 0; index < count; index += 1) {
      if (mask & (2 ** index)) {
        selected += 1;
        for (const id of cutSets[index]) union.add(id);
      }
    }
    let probability = 1;
    for (const id of union) probability *= clamp01(eventProbs.get(id) ?? 0);
    total += (selected % 2 === 1 ? 1 : -1) * probability;
  }
  return { total: clamp01(total), disjointProbs: cutSetProbs };
}

/** Fussell–Vesely importance: fraction of top-event probability involving event i. */
export function fussellVesely(
  eventId: string,
  cutSets: string[][],
  cutSetProbabilities: number[],
  qTop: number,
) {
  if (qTop <= 0) return 0;
  let involved = 0;
  for (let j = 0; j < cutSets.length; j += 1) {
    if (cutSets[j].includes(eventId)) involved += cutSetProbabilities[j];
  }
  return clamp01(involved / qTop);
}

/** Birnbaum importance: ∂Q_top/∂q_i approximated numerically. */
export function birnbaum(
  eventId: string,
  computeQTop: (eventProbs: Map<string, number>) => number,
  eventProbs: Map<string, number>,
  epsilon = 1e-6,
) {
  const base = computeQTop(eventProbs);
  const perturbed = new Map(eventProbs);
  const current = clamp01(eventProbs.get(eventId) ?? 0);
  perturbed.set(eventId, clamp01(current + epsilon));
  const perturbedQ = computeQTop(perturbed);
  return (perturbedQ - base) / epsilon;
}

/** Evaluate a single static gate. */
export function evaluateGate(
  type: FtaGateType | string,
  inputs: number[],
  k?: number,
  ccf?: { beta: number; groupSize: number },
) {
  const probabilities = inputs.map(clamp01);
  if (!probabilities.length) return 0;

  // Apply CCF to redundant groups before static combination
  let effective = probabilities;
  if (ccf && probabilities.length > 1) {
    const q = probabilities[0]; // assume identical inputs for CCF group
    const n = probabilities.length;
    effective = [ccfBetaFactor(q, ccf.beta, n)];
  }

  if (type === "gate and") return effective.reduce((result, value) => result * value, 1);
  if (type === "gate or") return 1 - effective.reduce((result, value) => result * (1 - value), 1);
  if (type === "gate xor") {
    // Exactly one input occurs (general n-input exclusive OR).
    const exclusive = effective.reduce((sum, value, index) => {
      let term = value;
      for (let other = 0; other < effective.length; other += 1) {
        if (other !== index) term *= 1 - effective[other];
      }
      return sum + term;
    }, 0);
    return clamp01(exclusive);
  }
  if (type === "gate not") return 1 - effective[0];
  if (type === "gate vote") return atLeastK(effective, k ?? Math.ceil(effective.length / 2));
  if (type === "gate inhibit") {
    // INHIBIT: input occurs AND enabling condition is true
    // inputs[0] = event probability, inputs[1] = condition probability
    if (effective.length < 2) return 0;
    return effective[0] * effective[1];
  }
  if (type === "gate nor") {
    return effective.reduce((result, value) => result * (1 - value), 1);
  }
  if (type === "gate nand") {
    return 1 - effective.reduce((result, value) => result * value, 1);
  }
  // Default: OR
  return 1 - effective.reduce((result, value) => result * (1 - value), 1);
}

/** Human-readable formula for a gate type. */
export function gateFormula(type?: FtaGateType | string, k?: number) {
  if (!type) return "Q(t) = 1 - e^(-λt)";
  if (type === "gate and") return "AND: Q = Π Qi";
  if (type === "gate or") return "OR: Q = 1 − Π(1 − Qi)";
  if (type === "gate xor") return "XOR: Q = Q1 + Q2 − 2·Q1·Q2";
  if (type === "gate not") return "NOT: Q = 1 − Q1";
  if (type === "gate vote") return `VOTING (k=${k ?? "⌈n/2⌉"}): Q = Σ C(n,i)·Qi·(1−Q)^(n−i)`;
  if (type === "gate inhibit") return "INHIBIT: Q = Q_event × Q_condition";
  if (type === "gate nor") return "NOR: Q = Π(1 − Qi)";
  if (type === "gate nand") return "NAND: Q = 1 − Π Qi";
  if (type === "gate pand") return "PAND (dynamic): solved via Markov chain";
  if (type === "gate seq") return "SEQ (dynamic): solved via Markov chain";
  if (type === "gate spare") return "SPARE (dynamic): solved via Markov chain";
  return "OR: Q = 1 − Π(1 − Qi)";
}

/** Combine minimal cut sets to top-event probability using all three methods. */
export function combineCutSets(
  cutSets: string[][],
  eventProbs: Map<string, number>,
  method: "rare" | "ep" | "exact" = "rare",
) {
  const probs = cutSets.map((cs) => cutSetProbability(cs, eventProbs));
  let result: number;
  let validity: string;

  if (method === "exact") {
    const exact = exactDisjointing(cutSets, eventProbs);
    result = exact.total;
    validity = "Exact inclusion–exclusion over minimal cut sets (IEC 61025 Annex B)";
  } else if (method === "ep") {
    result = esaryProschan(probs);
    validity = "Esary–Proschan approximation";
  } else {
    const bound = rareEventBound(probs);
    result = bound;
    validity = bound <= 0.1 ? "Rare-event upper bound (valid)" : "Rare-event bound (ΣQj > 0.1, use exact)";
  }

  return {
    qTop: clamp01(result),
    method,
    validity,
    cutSetProbabilities: probs,
    cutSets,
  };
}
