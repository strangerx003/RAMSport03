import type { DatabaseSync } from "node:sqlite";
import {
  emptyWorkspace,
  isWorkspaceState,
  type DiagramEdge,
  type DiagramNode,
  type RbdGroup,
  type WorkspaceComponent,
  type WorkspaceMode,
  type WorkspaceState,
} from "@/lib/workspace/types";

/* ------------------------------------------------------------------ library */

/**
 * The component library is the PBS component level, enriched with the current
 * failure rate and the MTTR record. Nothing is copied: every load reads the
 * live values, so a λ change in the register is visible in the workbench immediately.
 */
export function workspaceComponents(db: DatabaseSync, projectId: string): WorkspaceComponent[] {
  const rows = db
    .prepare(
      `SELECT n.id, n.name, n.part_number, n.quantity,
              p.name AS parent_name,
              f.lambda_per_hour,
              m.mttr_hours
         FROM pbs_nodes n
         LEFT JOIN pbs_nodes p ON p.id = n.parent_id
         LEFT JOIN failure_rates f ON f.pbs_node_id = n.id
         LEFT JOIN mttr_records m ON m.pbs_node_id = n.id
        WHERE n.project_id = ? AND n.level = 'component'
        ORDER BY COALESCE(p.name, ''), n.sort_order, n.name`,
    )
    .all(projectId) as any[];

  return rows.map((row) => ({
    id: row.id as string,
    tag: (row.part_number as string | null) || (row.name as string),
    description: row.name as string,
    system: (row.parent_name as string | null) || "Unassigned",
    lambda: Number(row.lambda_per_hour) || 0,
    mttr: row.mttr_hours == null ? 0 : Number(row.mttr_hours) || 0,
    mission: 0,
    quantity: Number(row.quantity) || 1,
  }));
}

export function workspaceMeta(db: DatabaseSync, projectId: string, mode: WorkspaceMode, projectMission: number) {
  if (mode === "rbd") {
    const model = db
      .prepare("SELECT name, mission_hours FROM rbd_models WHERE project_id = ? ORDER BY created_at LIMIT 1")
      .get(projectId) as any;
    return {
      title: model?.name || "Reliability block diagram",
      missionHours: Number(model?.mission_hours) || projectMission || 8760,
    };
  }
  const tree = db
    .prepare("SELECT name, mission_hours FROM fault_trees WHERE project_id = ? ORDER BY created_at LIMIT 1")
    .get(projectId) as any;
  return {
    title: tree?.name || "Fault tree",
    missionHours: Number(tree?.mission_hours) || projectMission || 8760,
  };
}

/* ------------------------------------------------------------------ load */

export function readWorkspace(
  db: DatabaseSync,
  projectId: string,
  mode: WorkspaceMode,
  components: WorkspaceComponent[],
  missionHours: number,
): WorkspaceState {
  const row = db
    .prepare("SELECT state FROM diagram_workspaces WHERE project_id = ? AND mode = ?")
    .get(projectId, mode) as any;
  if (row?.state) {
    try {
      const parsed = JSON.parse(row.state);
      if (isWorkspaceState(parsed)) {
        const state: WorkspaceState = {
          version: 1,
          nodes: parsed.nodes ?? [],
          edges: parsed.edges ?? [],
          groups: parsed.groups ?? [],
          missionHours: Number(parsed.missionHours) || missionHours,
        };
        return mode === "fta" ? upgradeLegacySeededFtaState(state) : state;
      }
    } catch {
      // A corrupt document must never block the module: fall back to the seed.
    }
  }
  return mode === "rbd"
    ? seedRbdFromBlocks(db, projectId, components, missionHours)
    : seedFtaFromTree(db, projectId, components, missionHours);
}

/**
 * Early workbench builds projected every stored gate row as a bare gate. That
 * erased the named output/top event and produced a non-standard example tree.
 * Seeded gates are identifiable by their row label in `subtitle`; gates created
 * in the editor use the neutral "Logic gate" subtitle. Upgrade only that legacy
 * projection and leave user-authored diagrams and positions untouched.
 */
function upgradeLegacySeededFtaState(state: WorkspaceState): WorkspaceState {
  const legacyGates = state.nodes.filter(
    (node) => node.type.startsWith("gate ") && node.subtitle && node.subtitle !== "Logic gate",
  );
  if (!legacyGates.length) return state;

  let nextId = Math.max(0, ...state.nodes.map((node) => node.id)) + 1;
  const outputByGate = new Map<number, number>();
  const nodes = state.nodes.map((node) => {
    if (!legacyGates.some((gate) => gate.id === node.id)) return node;
    outputByGate.set(node.id, nextId++);
    return { ...node, y: node.y + 118, subtitle: "Logic gate" };
  });
  for (const gate of legacyGates) {
    const outputId = outputByGate.get(gate.id)!;
    const isRoot = !state.edges.some((edge) => edge.from === gate.id);
    nodes.push({
      id: outputId,
      x: gate.x - 71,
      y: gate.y,
      type: isRoot ? "event top" : "event intermediate",
      title: gate.subtitle,
      subtitle: gate.subtitle,
    });
  }
  const edges: DiagramEdge[] = state.edges.map((edge) => ({
    ...edge,
    from: outputByGate.get(edge.from) ?? edge.from,
    waypoint: undefined,
  }));
  for (const gate of legacyGates) {
    edges.push({ from: gate.id, to: outputByGate.get(gate.id)!, style: "elbow" });
  }
  const cleanEdges = dedupeEdges(edges);
  const top = nodes.find((node) => node.type === "event top");
  if (!top) return { ...state, nodes, edges: cleanEdges };

  const depths = new Map<number, number>([[top.id, 0]]);
  const queue = [top.id];
  while (queue.length) {
    const target = queue.shift()!;
    const depth = depths.get(target) ?? 0;
    for (const edge of cleanEdges.filter((item) => item.to === target)) {
      if (!depths.has(edge.from)) {
        depths.set(edge.from, depth + 1);
        queue.push(edge.from);
      }
    }
  }
  const levels = new Map<number, DiagramNode[]>();
  for (const node of nodes) {
    const depth = depths.get(node.id) ?? Math.max(0, ...depths.values()) + 1;
    levels.set(depth, [...(levels.get(depth) ?? []), node]);
  }
  const aligned = nodes.map((node) => {
    const depth = depths.get(node.id) ?? Math.max(0, ...depths.values()) + 1;
    const level = levels.get(depth) ?? [node];
    const index = level.findIndex((item) => item.id === node.id);
    const levelWidth = (level.length - 1) * 245;
    const centerOffset = node.type.startsWith("gate ") ? 27 : 98;
    return { ...node, x: 900 - levelWidth / 2 + index * 245 - centerOffset, y: 45 + depth * 165 };
  });
  return { ...state, nodes: aligned, edges: cleanEdges };
}

/* ------------------------------------------------------------------ seed: RBD */

function reliabilityToLambda(reliability: number, missionHours: number) {
  const p = Math.min(Math.max(reliability, 1e-12), 1);
  return -Math.log(p) / Math.max(1, missionHours);
}

/**
 * The clone stores RBD blocks as ordered stage groups, not coordinates. Seed a
 * left-to-right diagram: a series stage becomes a chain, a parallel or k/n stage
 * becomes a column of branches between the previous and next stage.
 */
function seedRbdFromBlocks(
  db: DatabaseSync,
  projectId: string,
  components: WorkspaceComponent[],
  missionHours: number,
): WorkspaceState {
  const model = db
    .prepare("SELECT * FROM rbd_models WHERE project_id = ? ORDER BY created_at LIMIT 1")
    .get(projectId) as any;
  if (!model) return emptyWorkspace(missionHours);
  const blocks = db
    .prepare("SELECT * FROM rbd_blocks WHERE model_id = ? ORDER BY sort_order, id")
    .all(model.id) as any[];
  if (!blocks.length) return emptyWorkspace(missionHours);

  const byId = new Map(components.map((component) => [component.id, component]));
  const order: string[] = [];
  const stages = new Map<string, any[]>();
  for (const block of blocks) {
    const key = block.group_key || "main";
    if (!stages.has(key)) {
      stages.set(key, []);
      order.push(key);
    }
    stages.get(key)!.push(block);
  }

  const nodes: DiagramNode[] = [];
  const nodeIdByBlock = new Map<string, number>();
  let nextId = 1;
  order.forEach((key, stageIndex) => {
    const stageBlocks = stages.get(key)!;
    stageBlocks.forEach((block, blockIndex) => {
      const id = nextId++;
      nodeIdByBlock.set(block.id, id);
      const component = block.pbs_node_id ? byId.get(block.pbs_node_id) : undefined;
      const lambda = component ? component.lambda : reliabilityToLambda(Number(block.reliability) || 0, missionHours);
      nodes.push({
        id,
        x: 90 + stageIndex * 285,
        y: 90 + blockIndex * 175,
        type: "block",
        title: block.label || component?.tag || `Block ${id}`,
        subtitle: component?.description || block.label || "",
        assetId: component?.id,
        failureRate: lambda,
        mttr: component?.mttr ?? 0,
      });
    });
  });

  const edges: DiagramEdge[] = [];
  const stageNodes = order.map((key) => stages.get(key)!.map((block) => nodeIdByBlock.get(block.id)!));
  order.forEach((key, stageIndex) => {
    const list = stages.get(key)!;
    const ids = stageNodes[stageIndex];
    if ((list[0]?.group_type || "series") === "series" && ids.length > 1) {
      for (let index = 1; index < ids.length; index += 1) {
        edges.push({ from: ids[index - 1], to: ids[index], style: "elbow" });
      }
    }
    if (stageIndex === order.length - 1) return;
    const type = list[0]?.group_type || "series";
    const nextList = stages.get(order[stageIndex + 1])!;
    const nextType = nextList[0]?.group_type || "series";
    const exits = type === "series" ? [ids[ids.length - 1]] : ids;
    const entries = nextType === "series" ? [stageNodes[stageIndex + 1][0]] : stageNodes[stageIndex + 1];
    for (const exit of exits) {
      for (const entry of entries) edges.push({ from: exit, to: entry, style: "elbow" });
    }
  });

  return { version: 1, nodes, edges: dedupeEdges(edges), groups: [], missionHours };
}

/* ------------------------------------------------------------------ seed: FTA */

/**
 * The clone stores the fault tree as parent/child rows. Seed the workbench with
 * a depth-first layout: root at the top, each generation one row lower, events
 * and gates centred under their parent group.
 */
function seedFtaFromTree(
  db: DatabaseSync,
  projectId: string,
  components: WorkspaceComponent[],
  missionHours: number,
): WorkspaceState {
  const tree = db
    .prepare("SELECT * FROM fault_trees WHERE project_id = ? ORDER BY created_at LIMIT 1")
    .get(projectId) as any;
  if (!tree) return emptyWorkspace(missionHours);
  const rows = db
    .prepare("SELECT * FROM fault_tree_nodes WHERE tree_id = ? ORDER BY sort_order, id")
    .all(tree.id) as any[];
  if (!rows.length) return emptyWorkspace(missionHours);

  const byId = new Map(components.map((component) => [component.id, component]));
  const parentOf = new Map<string, string | null>(rows.map((row) => [row.id, row.parent_id ?? null]));
  const depthCache = new Map<string, number>();
  const depthOf = (id: string, guard = 0): number => {
    if (depthCache.has(id)) return depthCache.get(id)!;
    if (guard > 64) return 0;
    const parent = parentOf.get(id);
    const depth = parent ? depthOf(parent, guard + 1) + 1 : 0;
    depthCache.set(id, depth);
    return depth;
  };

  const levels = new Map<number, any[]>();
  for (const row of rows) {
    const depth = depthOf(row.id);
    levels.set(depth, [...(levels.get(depth) ?? []), row]);
  }

  const eventIdByRow = new Map<string, number>();
  const gateIdByRow = new Map<string, number>();
  let nextId = 1;
  for (const row of rows) {
    eventIdByRow.set(row.id, nextId++);
    if (row.node_type === "gate") gateIdByRow.set(row.id, nextId++);
  }

  const nodes: DiagramNode[] = [];
  for (const row of rows) {
    const depth = depthOf(row.id);
    const level = levels.get(depth) ?? [row];
    const index = level.findIndex((item) => item.id === row.id);
    const gateRow = row.node_type === "gate";
    const spacing = 260;
    const width = (level.length - 1) * spacing;
    const component = row.pbs_node_id ? byId.get(row.pbs_node_id) : undefined;
    const centerX = 900 - width / 2 + index * spacing;
    const eventY = 45 + depth * 265;
    nodes.push({
      id: eventIdByRow.get(row.id)!,
      x: centerX - 98,
      y: eventY,
      type: gateRow ? (row.parent_id ? "event intermediate" : "event top") : "event basic",
      title: component?.tag || row.label || "Event",
      subtitle: row.label || component?.description || "",
      assetId: component?.id,
      failureRate: component?.lambda,
      mttr: component?.mttr,
    });
    if (gateRow) {
      const type = `gate ${row.gate_type === "voting" ? "vote" : row.gate_type || "or"}`;
      nodes.push({
        id: gateIdByRow.get(row.id)!,
        x: centerX - 27,
        y: eventY + 132,
        type,
        title: type.replace("gate ", "").toUpperCase(),
        subtitle: "Logic gate",
        gateK: row.gate_type === "voting" ? Number(row.gate_k) || 2 : undefined,
      });
    }
  }

  // A stored gate row represents a named output event plus its logic gate.
  // Draw both symbols: children feed the gate and the gate feeds its output.
  // This is the standard top-event -> gate -> causes fault-tree structure.
  const edges: DiagramEdge[] = [];
  for (const row of rows) {
    const eventId = eventIdByRow.get(row.id)!;
    const gateId = gateIdByRow.get(row.id);
    if (gateId) edges.push({ from: gateId, to: eventId, style: "elbow" });
    if (!row.parent_id) continue;
    const parentTarget = gateIdByRow.get(row.parent_id) ?? eventIdByRow.get(row.parent_id);
    if (parentTarget) edges.push({ from: eventId, to: parentTarget, style: "elbow" });
  }

  return { version: 1, nodes, edges: dedupeEdges(edges), groups: [], missionHours };
}

/* ------------------------------------------------------------------ write */

function dedupeEdges(edges: DiagramEdge[]) {
  return edges.filter(
    (edge, index, all) => index === all.findIndex((other) => other.from === edge.from && other.to === edge.to),
  );
}

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Server-side guard for the autosave payload. The editor is trusted only as far
 * as its shape: every node, edge and group is rebuilt from known fields, with
 * caps that keep a runaway document out of SQLite.
 */
export function normalizeWorkspaceState(raw: unknown, missionHours: number): WorkspaceState {
  if (!raw || typeof raw !== "object") throw new Error("Invalid workspace document.");
  const candidate = raw as Record<string, unknown>;
  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) {
    throw new Error("Invalid workspace document.");
  }
  if (candidate.nodes.length > 400) throw new Error("The diagram has too many nodes to save.");
  if (candidate.edges.length > 1200) throw new Error("The diagram has too many connections to save.");

  const nodes: DiagramNode[] = candidate.nodes.map((value) => {
    const node = value as Record<string, unknown>;
    const id = Math.trunc(finite(node.id));
    if (!id) throw new Error("A node is missing its identifier.");
    return {
      id,
      x: Math.max(0, finite(node.x)),
      y: Math.max(0, finite(node.y)),
      type: String(node.type || "block").slice(0, 40),
      title: String(node.title || "").slice(0, 160),
      subtitle: String(node.subtitle || "").slice(0, 240),
      assetId: node.assetId ? String(node.assetId).slice(0, 120) : undefined,
      groupId: node.groupId ? String(node.groupId).slice(0, 120) : undefined,
      failureRate: node.failureRate == null ? undefined : Math.max(0, finite(node.failureRate)),
      mttr: node.mttr == null ? undefined : Math.max(0, finite(node.mttr)),
      mission: node.mission == null ? undefined : Math.max(0, finite(node.mission)),
      gateK: node.gateK == null ? undefined : Math.max(1, Math.trunc(finite(node.gateK, 2))),
    };
  });

  const ids = new Set(nodes.map((node) => node.id));
  const edges: DiagramEdge[] = candidate.edges
    .map((value) => {
      const edge = value as Record<string, unknown>;
      return {
        from: Math.trunc(finite(edge.from)),
        to: Math.trunc(finite(edge.to)),
        style: edge.style === "straight" ? ("straight" as const) : ("elbow" as const),
        fromSide: ["left", "right", "top", "bottom"].includes(String(edge.fromSide))
          ? (edge.fromSide as DiagramEdge["fromSide"])
          : undefined,
        toSide: ["left", "right", "top", "bottom"].includes(String(edge.toSide))
          ? (edge.toSide as DiagramEdge["toSide"])
          : undefined,
        waypoint:
          edge.waypoint && typeof edge.waypoint === "object"
            ? {
                x: Math.max(0, finite((edge.waypoint as any).x)),
                y: Math.max(0, finite((edge.waypoint as any).y)),
              }
            : undefined,
      };
    })
    .filter((edge) => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to);

  const groups: RbdGroup[] = Array.isArray(candidate.groups)
    ? (candidate.groups as unknown[]).slice(0, 100).map((value) => {
        const group = value as Record<string, any>;
        return {
          id: String(group.id || "").slice(0, 120),
          tag: String(group.tag || "GRP").slice(0, 40),
          name: String(group.name || "Group").slice(0, 120),
          failureRate: Math.max(0, finite(group.failureRate)),
          mtbf: Math.max(0, finite(group.mtbf)),
          mttr: Math.max(0, finite(group.mttr)),
          availability: Math.min(1, Math.max(0, finite(group.availability))),
          configuration: String(group.configuration || "Series").slice(0, 40),
          paths: Math.max(0, Math.trunc(finite(group.paths))),
          memberCount: Math.max(0, Math.trunc(finite(group.memberCount))),
          createdAt: String(group.createdAt || new Date().toISOString()).slice(0, 40),
          formulaVersion: "rbd-sheet-v1" as const,
        };
      })
    : [];

  return {
    version: 1,
    nodes,
    edges,
    groups,
    missionHours: Math.max(1, finite(candidate.missionHours, missionHours)),
  };
}
