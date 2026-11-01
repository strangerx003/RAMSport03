/**
 * RBD core - graph reduction for reliability block diagrams.
 *
 * A diagram is a set of components connected by links. The left-most blocks
 * are the sources and the right-most blocks are the sinks. Every simple path
 * between a source and a sink is enumerated; a single path reduces with the
 * series equations, and several independent paths reduce with the K-out-of-N
 * equations after shared blocks are pulled out in series.
 */

import { componentAvailability, meanTimeBetweenFailures } from "@/lib/workspace/reliability";
import { kOutOfNFormulas, seriesFormulas, singleBlockFormulas } from "@/lib/workspace/rbd-formulas";

export * from "@/lib/workspace/rbd-formulas";
export { componentAvailability, meanTimeBetweenFailures };

export type RbdComponent = {
  id: number;
  x: number;
  availability: number;
  failureRate?: number;
  mttr?: number;
};

export type RbdLink = { from: number; to: number };

export type RbdAnalysis = {
  availability: number;
  unavailability: number;
  configuration: "Single block" | "Series" | "K-out-of-N" | "Open";
  paths: number;
  exact: boolean;
  note: string;
  formula: string;
  koon?: { k: number; n: number };
  failureRate: number;
  mtbf: number;
  mttr: number;
};

type EquivalentMetrics = {
  availability: number;
  failureRate: number;
  mtbf: number;
  mttr: number;
};

const PATH_LIMIT = 200;

function adjacency(components: RbdComponent[], links: RbdLink[]) {
  const graph = new Map<number, number[]>(components.map((component) => [component.id, []]));
  for (const link of links) {
    if (!graph.has(link.from) || !graph.has(link.to) || link.from === link.to) continue;
    graph.get(link.from)!.push(link.to);
    graph.get(link.to)!.push(link.from);
  }
  return graph;
}

function listPaths(graph: Map<number, number[]>, start: number, end: number) {
  const paths: number[][] = [];
  const walk = (current: number, path: number[], visited: Set<number>) => {
    if (paths.length >= PATH_LIMIT) return;
    if (current === end) {
      paths.push(path);
      return;
    }
    for (const next of graph.get(current) ?? []) {
      if (!visited.has(next)) walk(next, [...path, next], new Set(visited).add(next));
    }
  };
  walk(start, [start], new Set([start]));
  return paths;
}

function openResult(note: string): RbdAnalysis {
  return {
    availability: 0,
    unavailability: 1,
    configuration: "Open",
    paths: 0,
    exact: true,
    note,
    formula: "No formula applied",
    failureRate: 0,
    mtbf: 0,
    mttr: 0,
  };
}

/**
 * Left-most blocks feed the diagram and right-most blocks terminate it. When
 * several blocks share the same x, every one of them is a source or a sink, so
 * a parallel first or final stage still produces one path per branch.
 */
function terminalIds(components: RbdComponent[], edge: "min" | "max") {
  const values = components.map((component) => component.x);
  const terminal = edge === "min" ? Math.min(...values) : Math.max(...values);
  return components.filter((component) => component.x === terminal).map((component) => component.id);
}

export function analyzeRbd(components: RbdComponent[], links: RbdLink[]): RbdAnalysis {
  if (!components.length) return openResult("No reliability blocks are present.");
  if (components.length === 1) {
    const component = components[0];
    const metrics = singleBlockFormulas(component);
    return {
      ...metrics,
      unavailability: 1 - metrics.availability,
      configuration: "Single block",
      paths: 1,
      exact: true,
      note: "System result equals the selected component values.",
      formula: "MTBF = 1 / λ",
    };
  }

  const sources = terminalIds(components, "min");
  const sinks = terminalIds(components, "max").filter((id) => !sources.includes(id));
  if (!sources.length || !sinks.length) {
    return openResult("Place the blocks left-to-right so the diagram has an input and an output side.");
  }

  const graph = adjacency(components, links);
  const seen = new Set<string>();
  const paths: number[][] = [];
  for (const source of sources) {
    for (const sink of sinks) {
      for (const path of listPaths(graph, source, sink)) {
        const key = path.join(">");
        if (seen.has(key)) continue;
        seen.add(key);
        paths.push(path);
      }
    }
  }
  if (!paths.length) return openResult("No complete path exists between the left-most and right-most blocks.");

  const componentById = new Map(components.map((component) => [component.id, component]));
  const reachableIds = new Set(paths.flat());
  const reachable = components.filter((component) => reachableIds.has(component.id));
  const disconnected = components.length - reachable.length;

  if (paths.length === 1) {
    const metrics = seriesFormulas(reachable);
    return {
      ...metrics,
      unavailability: 1 - metrics.availability,
      configuration: "Series",
      paths: 1,
      exact: true,
      note: disconnected
        ? `Applied the series equations to the ${reachable.length} connected blocks; ${disconnected} disconnected block(s) were ignored.`
        : "Applied the series equations from the approved formula sheet.",
      formula: "λs = Σλi; MTTRs = Σ(λi × MTTRi) / λs; MTBFs = 1 / λs",
    };
  }

  // Shared blocks sit in series with the redundant branch set. Each remaining
  // complete branch is reduced to a series-equivalent channel before 1ooN.
  const commonIds = paths.reduce(
    (common, path) => new Set([...common].filter((id) => path.includes(id))),
    new Set(paths[0]),
  );
  const branchKeys = [
    ...new Set(
      paths
        .map((path) => path.filter((id) => !commonIds.has(id)).sort((a, b) => a - b).join(","))
        .filter(Boolean),
    ),
  ];
  const branchChannels: RbdComponent[] = branchKeys.map((key, index) => {
    const branch = key
      .split(",")
      .map(Number)
      .map((id) => componentById.get(id))
      .filter((component): component is RbdComponent => Boolean(component));
    const metrics = seriesFormulas(branch);
    return { id: -(index + 1), x: index, ...metrics };
  });
  if (branchChannels.length < 2) {
    return openResult("The redundant branches could not be resolved into independent K-out-of-N channels.");
  }

  const k = 1;
  const n = branchChannels.length;
  const koon = kOutOfNFormulas(branchChannels, k);
  const common = [...commonIds]
    .map((id) => componentById.get(id))
    .filter((component): component is RbdComponent => Boolean(component));
  const combined: EquivalentMetrics = common.length ? seriesFormulas([...common, { id: -1000, x: 0, ...koon }]) : koon;
  return {
    ...combined,
    unavailability: 1 - combined.availability,
    configuration: "K-out-of-N",
    koon: { k, n },
    paths: n,
    exact: true,
    note: `Applied ${k}oo${n} using the K-out-of-N equation from the approved formula sheet${
      common.length ? ", with shared blocks combined in series" : ""
    }.`,
    formula: "λs = n! / ((r−1)!(n-r+1)!) × λi^(n-r+1) × Ti^(n-r); MTTRs = 1 / ((n-r+1)μ)",
  };
}

export function createRbdBlock(id: number, x: number, y: number, options: Partial<RbdComponent> = {}) {
  return {
    id,
    x,
    y,
    availability: options.availability ?? 0,
    failureRate: options.failureRate,
    mttr: options.mttr,
  };
}

export function createRbdLink(from: number, to: number): RbdLink {
  return { from, to };
}

export function getBlockById(blocks: RbdComponent[], id: number) {
  return blocks.find((block) => block.id === id);
}

export function validateConnection(blocks: RbdComponent[], from: number, to: number) {
  if (from === to) return false;
  if (!getBlockById(blocks, from) || !getBlockById(blocks, to)) return false;
  return true;
}
