import type { DatabaseSync } from "node:sqlite";
import {
  alarp,
  availability,
  computeFta,
  computeRbd,
  criticality,
  mttrHours,
  riskScore,
  riskBand,
  sparesModel,
  weightedMean,
  type FtaNodeRow,
  type RbdBlockRow,
} from "@/lib/calc";
import { daysUntil } from "@/lib/format";

/* ------------------------------------------------------------------ PBS */

export type PbsNode = any & {
  children: PbsNode[];
  ownLambda: number | null;
  subtreeLambda: number;
  componentCount: number;
  subtreeMttr: number | null;
};

export function pbsRows(db: DatabaseSync, projectId: string) {
  return db
    .prepare("SELECT * FROM pbs_nodes WHERE project_id = ? ORDER BY depth, sort_order, name")
    .all(projectId) as any[];
}

/**
 * A failure rate is recorded per unit. Multiply by the line quantity so an assembly of
 * three servos carries three times the rate of one servo. Only components are counted:
 * a system or subsystem row is a container, even if someone typed a rate against it.
 */
export function ownLambdaTotal(node: any): number {
  const perUnit = node.ownLambda ?? 0;
  return node.level === "component" ? perUnit * (node.quantity || 1) : 0;
}

export function pbsTree(db: DatabaseSync, projectId: string): PbsNode[] {
  const rows = pbsRows(db, projectId);
  const rates = db
    .prepare("SELECT pbs_node_id, lambda_per_hour FROM failure_rates WHERE project_id = ?")
    .all(projectId) as any[];
  const mttrs = db
    .prepare("SELECT pbs_node_id, mttr_hours FROM mttr_records WHERE project_id = ?")
    .all(projectId) as any[];
  const lambdaBy = new Map(rates.map((r) => [r.pbs_node_id, r.lambda_per_hour as number]));
  const mttrBy = new Map(mttrs.map((r) => [r.pbs_node_id, r.mttr_hours as number | null]));

  const nodes: PbsNode[] = rows.map((r) => ({
    ...r,
    children: [],
    ownLambda: lambdaBy.has(r.id) ? (lambdaBy.get(r.id) as number) : null,
    subtreeLambda: 0,
    componentCount: r.level === "component" ? 1 : 0,
    subtreeMttr: null,
    ownMttr: mttrBy.get(r.id) ?? null,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots: PbsNode[] = [];
  for (const node of nodes) {
    const parent = node.parent_id ? byId.get(node.parent_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  for (const list of byId.values()) list.children.sort((a, b) => a.sort_order - b.sort_order);

  const depths = [...nodes].sort((a, b) => b.depth - a.depth);
  for (const node of depths) {
    // ownLambda is per unit, so a line of three servos contributes 3 x its rate to the
    // assembly. That is the same rule the register and project totals use, which keeps the
    // system lambda identical on every screen.
    node.subtreeLambda = ownLambdaTotal(node) + node.children.reduce((s, c) => s + c.subtreeLambda, 0);
    node.componentCount =
      (node.level === "component" ? 1 : 0) + node.children.reduce((s, c) => s + c.componentCount, 0);
    const weighted = [
      ...(node.ownMttr != null ? [{ value: node.ownMttr, weight: ownLambdaTotal(node) }] : []),
      ...node.children
        .filter((c) => c.subtreeMttr != null)
        .map((c) => ({ value: c.subtreeMttr as number, weight: c.subtreeLambda })),
    ];
    node.subtreeMttr = weightedMean(weighted);
  }
  return roots;
}

export function flattenTree(roots: PbsNode[], depth = 0): (PbsNode & { uiDepth: number })[] {
  const out: any[] = [];
  for (const node of roots) {
    out.push({ ...node, uiDepth: depth });
    out.push(...flattenTree(node.children, depth + 1));
  }
  return out;
}

/* ------------------------------------------------------------------ Rates */

export function componentRows(db: DatabaseSync, projectId: string) {
  return db
    .prepare(
      `SELECT n.*, p.name AS parent_name,
              f.pbs_node_id AS rate_node, f.method, f.lambda_per_hour, f.environment, f.quality,
              f.part_type, f.factors, f.source_ref, f.calculated_at
         FROM pbs_nodes n
         LEFT JOIN pbs_nodes p ON p.id = n.parent_id
         LEFT JOIN failure_rates f ON f.pbs_node_id = n.id
        WHERE n.project_id = ? AND n.level = 'component'
        ORDER BY n.sort_order, n.name`,
    )
    .all(projectId) as any[];
}

export function lambdaByNode(db: DatabaseSync, projectId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of db
    .prepare("SELECT pbs_node_id, lambda_per_hour FROM failure_rates WHERE project_id = ?")
    .all(projectId) as any[]) {
    out[row.pbs_node_id] = row.lambda_per_hour;
  }
  return out;
}

/* ------------------------------------------------------------------ MTTR */

export function mttrRows(db: DatabaseSync, projectId: string) {
  const rows = db
    .prepare(
      `SELECT r.*, n.name AS node_name, n.part_number, n.category, n.level,
              n.quantity AS node_quantity, p.name AS parent_name
         FROM mttr_records r
         JOIN pbs_nodes n ON n.id = r.pbs_node_id
         LEFT JOIN pbs_nodes p ON p.id = n.parent_id
        WHERE r.project_id = ?
        ORDER BY n.sort_order, n.name`,
    )
    .all(projectId) as any[];
  const steps = db
    .prepare("SELECT * FROM mttr_steps WHERE project_id = ? ORDER BY sort_order, id")
    .all(projectId) as any[];
  const byRecord = new Map<string, any[]>();
  for (const step of steps) {
    if (!byRecord.has(step.mttr_record_id)) byRecord.set(step.mttr_record_id, []);
    byRecord.get(step.mttr_record_id)!.push(step);
  }
  const lambda = lambdaByNode(db, projectId);
  return rows.map((row) => {
    const recordSteps = byRecord.get(row.id) ?? [];
    const totalMinutes = recordSteps.reduce((s, x) => s + x.minutes, 0);
    return {
      ...row,
      steps: recordSteps,
      total_minutes: totalMinutes,
      computed: mttrHours([{ minutes: totalMinutes }], row.manpower, row.spares_available === 1),
      lambda: lambda[row.pbs_node_id] ?? null,
    };
  });
}

/* ------------------------------------------------------------------ FMEA */

export function fmeaRows(db: DatabaseSync, projectId: string, kind: "dfmea" | "fmeca") {
  const rows = db
    .prepare(
      `SELECT f.*, n.name AS node_name, n.part_number, n.category, p.name AS parent_name
         FROM fmea_rows f
         JOIN pbs_nodes n ON n.id = f.pbs_node_id
         LEFT JOIN pbs_nodes p ON p.id = n.parent_id
        WHERE f.project_id = ? AND f.kind = ?
        ORDER BY ${kind === "fmeca" ? "f.cm DESC" : "f.rpn DESC"}, n.name`,
    )
    .all(projectId, kind) as any[];
  const lambda = lambdaByNode(db, projectId);
  return rows.map((row) => {
    const current = lambda[row.pbs_node_id] ?? 0;
    const stale =
      kind === "fmeca" &&
      row.lambda_used != null &&
      Math.abs((row.lambda_used ?? 0) - current) > 1e-12;
    return { ...row, current_lambda: current, stale };
  });
}

/* ------------------------------------------------------------------ PM */

export function pmRows(db: DatabaseSync, projectId: string) {
  return (
    db
      .prepare(
        `SELECT m.*, n.name AS node_name, n.part_number, n.category
           FROM maintenance_tasks m
           JOIN pbs_nodes n ON n.id = m.pbs_node_id
          WHERE m.project_id = ?
          ORDER BY m.next_due_at IS NULL, m.next_due_at, n.name`,
      )
      .all(projectId) as any[]
  ).map((row) => {
    const days = daysUntil(row.next_due_at);
    return {
      ...row,
      days_until: days,
      overdue: days != null && days < 0,
      due_soon: days != null && days >= 0 && days <= 30,
    };
  });
}

/* ------------------------------------------------------------------ spares */

export function sparesRows(db: DatabaseSync, projectId: string) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  const rows = db
    .prepare(
      `SELECT s.*, n.name AS node_name, n.part_number, n.category, n.quantity AS node_quantity
         FROM spare_items s
         JOIN pbs_nodes n ON n.id = s.pbs_node_id
        WHERE s.project_id = ?
        ORDER BY n.sort_order, n.name`,
    )
    .all(projectId) as any[];
  const lambda = lambdaByNode(db, projectId);
  return rows.map((row) => {
    const model = sparesModel({
      lambdaPerHour: lambda[row.pbs_node_id] ?? 0,
      operatingHoursPerYear: project?.operating_hours ?? 8760,
      leadTimeDays: row.lead_time_days,
      serviceLevel: row.service_level,
      quantity: row.node_quantity ?? 1,
    });
    const gap = (row.recommended_qty ?? model.recommendedQty) - row.qty_on_hand;
    return {
      ...row,
      model,
      lambda: lambda[row.pbs_node_id] ?? 0,
      gap,
      below_reorder: row.qty_on_hand < (row.reorder_point ?? model.reorderPoint),
      holding_cost: row.qty_on_hand * (row.unit_cost_cents || 0),
      annual_holding: row.qty_on_hand * (row.unit_cost_cents || 0) * 0.2,
    };
  });
}

/* ------------------------------------------------------------------ safety */

export function hazardRows(db: DatabaseSync, projectId: string) {
  const rows = db
    .prepare(
      `SELECT h.*, n.name AS node_name
         FROM hazards h LEFT JOIN pbs_nodes n ON n.id = h.pbs_node_id
        WHERE h.project_id = ?
        ORDER BY h.severity DESC, h.likelihood DESC`,
    )
    .all(projectId) as any[];
  return rows.map((row) => {
    const residualS = row.residual_severity ?? row.severity;
    const residualL = row.residual_likelihood ?? row.likelihood;
    let controls: any[] = [];
    try {
      controls = JSON.parse(row.controls || "[]");
    } catch {
      controls = [];
    }
    return {
      ...row,
      controls_list: controls,
      initial_risk: riskScore(row.severity, row.likelihood),
      residual_risk: riskScore(residualS, residualL),
      residual_band: riskBand(riskScore(residualS, residualL)),
      alarp: alarp(residualS, residualL),
    };
  });
}

/* ------------------------------------------------------------------ FTA */

export function ftaBundle(db: DatabaseSync, projectId: string) {
  const tree = db
    .prepare("SELECT * FROM fault_trees WHERE project_id = ? ORDER BY created_at LIMIT 1")
    .get(projectId) as any;
  if (!tree) return null;
  const nodes = db
    .prepare("SELECT * FROM fault_tree_nodes WHERE tree_id = ? ORDER BY sort_order, id")
    .all(tree.id) as FtaNodeRow[];
  const lambda = lambdaByNode(db, projectId);
  const result = computeFta(nodes, lambda, tree.mission_hours || 8760);
  return { tree, nodes, result };
}

export function ftaNodeTree(nodes: FtaNodeRow[]) {
  const byParent = new Map<string | null, FtaNodeRow[]>();
  for (const node of nodes) {
    const key = node.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(node);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.sort_order - b.sort_order);
  return { byParent, roots: byParent.get(null) ?? [] };
}

/* ------------------------------------------------------------------ RBD */

export function rbdBundle(db: DatabaseSync, projectId: string) {
  const model = db
    .prepare("SELECT * FROM rbd_models WHERE project_id = ? ORDER BY created_at LIMIT 1")
    .get(projectId) as any;
  if (!model) return null;
  const blocks = db
    .prepare("SELECT * FROM rbd_blocks WHERE model_id = ? ORDER BY sort_order, id")
    .all(model.id) as RbdBlockRow[];
  const lambda = lambdaByNode(db, projectId);
  const mttrs = db
    .prepare("SELECT pbs_node_id, mttr_hours FROM mttr_records WHERE project_id = ?")
    .all(projectId) as any[];
  const mttrBy = new Map(mttrs.map((r) => [r.pbs_node_id, r.mttr_hours as number]));
  const availabilityByBlock: Record<string, number | null> = {};
  for (const block of blocks) {
    const l = block.pbs_node_id ? lambda[block.pbs_node_id] : null;
    const m = block.pbs_node_id ? mttrBy.get(block.pbs_node_id) ?? null : null;
    availabilityByBlock[block.id] =
      l && l > 0 && m != null ? availability(1 / l, m) : null;
  }
  const result = computeRbd(blocks, availabilityByBlock, model.mission_hours || 8760);
  return { model, blocks, result, availabilityByBlock };
}

/* ------------------------------------------------------------------ reports & audit */

export function reportRows(db: DatabaseSync, projectId: string) {
  return db
    .prepare(
      `SELECT r.*, u.name AS generated_by_name, v.label AS version_label, v.rev AS version_rev
         FROM reports r
         LEFT JOIN users u ON u.id = r.generated_by
         LEFT JOIN analysis_versions v ON v.id = r.version_id
        WHERE r.project_id = ?
        ORDER BY r.generated_at DESC`,
    )
    .all(projectId) as any[];
}

export function auditRows(db: DatabaseSync, companyId: string, projectId?: string) {
  if (projectId) {
    return db
      .prepare(
        `SELECT a.*, u.name AS actor_name FROM audit_events a
           LEFT JOIN users u ON u.id = a.actor_id
          WHERE a.company_id = ? AND a.project_id = ?
          ORDER BY a.at DESC LIMIT 60`,
      )
      .all(companyId, projectId) as any[];
  }
  return db
    .prepare(
      `SELECT a.*, u.name AS actor_name FROM audit_events a
         LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.company_id = ?
        ORDER BY a.at DESC LIMIT 60`,
    )
    .all(companyId) as any[];
}

export function memberRows(db: DatabaseSync, projectId: string) {
  return (
    db
      .prepare(
        `SELECT m.*, u.name, u.email, u.role AS user_role, u.created_at AS user_since
           FROM project_members m JOIN users u ON u.id = m.user_id
          WHERE m.project_id = ?
          ORDER BY CASE m.role WHEN 'company_admin' THEN 0 WHEN 'employee' THEN 1 ELSE 2 END, u.name`,
      )
      .all(projectId) as any[]
  ).map((row) => {
    let grants: Record<string, string> = {};
    try {
      grants = JSON.parse(row.module_grants || "{}");
    } catch {
      grants = {};
    }
    return { ...row, grants };
  });
}

export function listProjects(db: DatabaseSync, user: any) {
  return db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM pbs_nodes n WHERE n.project_id = p.id AND n.level = 'component') AS component_count,
              (SELECT COUNT(*) FROM fmea_rows f WHERE f.project_id = p.id AND f.kind = 'fmeca') AS fmeca_count,
              (SELECT COUNT(*) FROM hazards h WHERE h.project_id = p.id AND h.alarp = 'unacceptable') AS open_hazards,
              (SELECT name FROM users u WHERE u.id IN (
                  SELECT user_id FROM project_members pm WHERE pm.project_id = p.id AND pm.role = 'company_admin'
              ) LIMIT 1) AS lead_name
         FROM projects p
        WHERE p.company_id = ?
          AND (p.status = 'active' OR p.status = 'archived')
          AND (
            EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?)
            OR ? IN ('company_admin','super_admin')
          )
        ORDER BY p.created_at DESC`,
    )
    .all(user.company_id, user.id, user.role) as any[];
}

/* ------------------------------------------------------------------ project roll-up */

export type ProjectStats = ReturnType<typeof projectStats>;

export function projectStats(db: DatabaseSync, projectId: string) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  const components = componentRows(db, projectId);
  const fmea = fmeaRows(db, projectId, "fmeca");
  const pm = pmRows(db, projectId);
  const spares = sparesRows(db, projectId);
  const hazards = hazardRows(db, projectId);
  const fta = ftaBundle(db, projectId);
  const rbd = rbdBundle(db, projectId);
  const mttr = mttrRows(db, projectId);
  const reports = reportRows(db, projectId);

  const totalLambda = components.reduce((s, c) => s + (c.lambda_per_hour || 0) * (c.quantity || 1), 0);
  const systemMtbf = totalLambda > 0 ? 1 / totalLambda : null;
  const weightedMttr = weightedMean(
    mttr
      .filter((m) => m.mttr_hours != null)
      .map((m) => ({ value: m.mttr_hours as number, weight: (m.lambda ?? 0) * (m.node_quantity || 1) })),
  );
  const systemAvailability =
    systemMtbf != null && weightedMttr != null ? availability(systemMtbf, weightedMttr) : null;

  const stale = fmea.filter((f) => f.stale).length;
  const unacceptable = hazards.filter((h) => h.alarp === "unacceptable");
  const overdue = pm.filter((t) => t.overdue);
  const stockouts = spares.filter((s) => s.below_reorder);
  const topRisks = fmea.slice(0, 5);

  const moduleCounts: Record<string, number> = {
    pbs: components.length,
    register: components.length,
    mttr: mttr.length,
    fmeca: fmea.length,
    pm: pm.length,
    spares: spares.length,
    safety: hazards.length,
    fta: fta?.nodes.length ?? 0,
    rbd: rbd?.blocks.length ?? 0,
    reports: reports.length,
  };

  return {
    project,
    components,
    fmeca: fmea,
    pm,
    spares,
    hazards,
    fta,
    rbd,
    mttr,
    reports,
    totalLambda,
    systemMtbf,
    weightedMttr,
    systemAvailability,
    stale,
    unacceptable,
    overdue,
    stockouts,
    topRisks,

    moduleCounts,
  };
}
