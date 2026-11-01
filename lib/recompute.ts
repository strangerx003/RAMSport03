import type { DatabaseSync } from "node:sqlite";
import {
  alarp,
  availability,
  computeFta,
  computeRbd,
  criticality,
  mttrHours,
  rankDescending,
  rpn,
  sparesModel,
  type FtaNodeRow,
  type RbdBlockRow,
} from "@/lib/calc";
import { addInterval } from "@/lib/format";

export type RecomputeSummary = {
  rev: number;
  fmeca: number;
  mttr: number;
  spares: number;
  pm: number;
  hazards: number;
  fta: number | null;
  rbd: number | null;
  durationMs: number;
};

/**
 * Recompute every derived value for one project from its current inputs.
 * Absolute writes only (never deltas) so the operation is idempotent: a retried
 * job produces exactly the same rows.
 */
export function recomputeProject(db: DatabaseSync, projectId: string): RecomputeSummary {
  const started = Date.now();
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (!project) throw new Error("Project not found");

  const nodes = db
    .prepare("SELECT id, name, quantity, parent_id, level FROM pbs_nodes WHERE project_id = ?")
    .all(projectId) as any[];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const rates = db
    .prepare("SELECT pbs_node_id, lambda_per_hour FROM failure_rates WHERE project_id = ?")
    .all(projectId) as any[];
  const lambdaByNode: Record<string, number> = {};
  for (const r of rates) lambdaByNode[r.pbs_node_id] = r.lambda_per_hour;

  /* ---------------------------------------------------------- FMEA */
  const fmeaRows = db
    .prepare("SELECT * FROM fmea_rows WHERE project_id = ?")
    .all(projectId) as any[];
  const updateFmea = db.prepare(
    `UPDATE fmea_rows
        SET rpn = ?, cm = ?, lambda_used = ?, priced_rev = ?, cr_rank = ?, version = version + 1
      WHERE id = ?`,
  );
  // Rows are priced inside the recompute that bumps the revision, so they belong
  // to the revision this pass produces.
  const pricedRev = project.rev + 1;

  let fmecaCount = 0;
  const fmeca = fmeaRows.filter((r) => r.kind === "fmeca");

  for (const row of fmeaRows) {
    if (row.kind === "dfmea") {
      const value = rpn(row.severity || 0, row.occurrence || 0, row.detection || 0);
      updateFmea.run(value, null, null, null, null, row.id);
    } else {
      const lambda = lambdaByNode[row.pbs_node_id] ?? 0;
      const missionT = row.mission_t ?? project.operating_hours * project.product_life_years;
      const cm = criticality(row.beta || 0, row.alpha || 0, lambda, missionT);
      updateFmea.run(null, cm, lambda, pricedRev, null, row.id);
      fmecaCount++;
    }
  }

  const ranked = db
    .prepare(
      `SELECT id, cm FROM fmea_rows WHERE project_id = ? AND kind = 'fmeca' ORDER BY cm DESC`,
    )
    .all(projectId) as { id: string; cm: number }[];
  const ranks = rankDescending(ranked);
  const setRank = db.prepare("UPDATE fmea_rows SET cr_rank = ? WHERE id = ?");
  for (const [id, rank] of ranks) setRank.run(rank, id);

  /* ---------------------------------------------------------- MTTR */
  const mttrRecords = db
    .prepare("SELECT * FROM mttr_records WHERE project_id = ?")
    .all(projectId) as any[];
  const spareByNode = new Map<string, any>();
  for (const spare of db
    .prepare("SELECT * FROM spare_items WHERE project_id = ?")
    .all(projectId) as any[]) {
    spareByNode.set(spare.pbs_node_id, spare);
  }
  const setMttr = db.prepare("UPDATE mttr_records SET mttr_hours = ? WHERE id = ?");
  const stepSum = db.prepare(
    "SELECT COALESCE(SUM(minutes), 0) AS minutes FROM mttr_steps WHERE mttr_record_id = ?",
  );
  for (const rec of mttrRecords) {
    const { minutes } = stepSum.get(rec.id) as any;
    const spare = spareByNode.get(rec.pbs_node_id);
    const delay = rec.spares_available
      ? 0
      : Math.min(720, spare?.lead_time_days ? spare.lead_time_days * 24 : 8);
    const value = mttrHours([{ minutes }], rec.manpower, true, 0) + delay;
    setMttr.run(value, rec.id);
  }

  /* ---------------------------------------------------------- spares */
  const spareRows = db
    .prepare("SELECT * FROM spare_items WHERE project_id = ?")
    .all(projectId) as any[];
  const setSpare = db.prepare(
    `UPDATE spare_items SET recommended_qty = ?, reorder_point = ?, safety_stock = ?,
            version = version + 1 WHERE id = ?`,
  );
  for (const spare of spareRows) {
    const node = nodeById.get(spare.pbs_node_id);
    const model = sparesModel({
      lambdaPerHour: lambdaByNode[spare.pbs_node_id] ?? 0,
      operatingHoursPerYear: project.operating_hours || 8760,
      leadTimeDays: spare.lead_time_days,
      serviceLevel: spare.service_level,
      quantity: node?.quantity ?? 1,
    });
    const recommended = Math.max(
      model.recommendedQty,
      Math.min(spare.moq, Math.max(model.recommendedQty, 1)),
    );
    setSpare.run(recommended, model.reorderPoint, model.safetyStock, spare.id);
  }

  /* ---------------------------------------------------------- PM */
  const tasks = db
    .prepare("SELECT * FROM maintenance_tasks WHERE project_id = ?")
    .all(projectId) as any[];
  const setDue = db.prepare("UPDATE maintenance_tasks SET next_due_at = ? WHERE id = ?");
  for (const task of tasks) {
    const base = task.last_done_at ? new Date(task.last_done_at.replace(" ", "T")) : new Date();
    const next = addInterval(base, task.interval_value || 1, task.interval_unit || "days");
    setDue.run(next.toISOString(), task.id);
  }

  /* ---------------------------------------------------------- safety */
  const hazards = db
    .prepare("SELECT * FROM hazards WHERE project_id = ?")
    .all(projectId) as any[];
  const setAlarp = db.prepare("UPDATE hazards SET alarp = ? WHERE id = ?");
  for (const hazard of hazards) {
    const s = hazard.residual_severity ?? hazard.severity;
    const l = hazard.residual_likelihood ?? hazard.likelihood;
    setAlarp.run(alarp(s, l), hazard.id);
  }

  /* ---------------------------------------------------------- FTA */
  const tree = db
    .prepare("SELECT * FROM fault_trees WHERE project_id = ? ORDER BY created_at LIMIT 1")
    .get(projectId) as any;
  let ftaQ: number | null = null;
  if (tree) {
    const rows = db
      .prepare("SELECT * FROM fault_tree_nodes WHERE tree_id = ? ORDER BY sort_order")
      .all(tree.id) as FtaNodeRow[];
    const result = computeFta(rows, lambdaByNode, tree.mission_hours || project.mission_hours);
    ftaQ = result.q;
    db.prepare(
      "UPDATE fault_trees SET q_t = ?, truncated = ?, computed_at = ?, version = version + 1 WHERE id = ?",
    ).run(result.q, result.truncated ? 1 : 0, new Date().toISOString(), tree.id);
  }

  /* ---------------------------------------------------------- RBD */
  const model = db
    .prepare("SELECT * FROM rbd_models WHERE project_id = ? ORDER BY created_at LIMIT 1")
    .get(projectId) as any;
  let rsys: number | null = null;
  if (model) {
    const blocks = db
      .prepare("SELECT * FROM rbd_blocks WHERE model_id = ? ORDER BY sort_order")
      .all(model.id) as RbdBlockRow[];
    const availabilityByBlock: Record<string, number | null> = {};
    const mttrByNode = new Map<string, number>();
    for (const rec of mttrRecords) mttrByNode.set(rec.pbs_node_id, rec.mttr_hours || 0);
    for (const block of blocks) {
      const lambda = block.pbs_node_id ? lambdaByNode[block.pbs_node_id] : null;
      const repair = block.pbs_node_id ? mttrByNode.get(block.pbs_node_id) ?? null : null;
      availabilityByBlock[block.id] =
        lambda && repair != null && lambda > 0 ? availability(1 / lambda, repair) : null;
    }
    const result = computeRbd(blocks, availabilityByBlock, model.mission_hours || project.mission_hours);
    rsys = result.rsys;
    db.prepare(
      "UPDATE rbd_models SET rsys = ?, availability = ?, computed_at = ?, version = version + 1 WHERE id = ?",
    ).run(result.rsys, result.availability, new Date().toISOString(), model.id);
  }

  /* ---------------------------------------------------------- revision */
  db.prepare("UPDATE projects SET rev = rev + 1 WHERE id = ?").run(projectId);
  const rev = (db.prepare("SELECT rev FROM projects WHERE id = ?").get(projectId) as any).rev;

  return {
    rev,
    fmeca: fmecaCount,
    mttr: mttrRecords.length,
    spares: spareRows.length,
    pm: tasks.length,
    hazards: hazards.length,
    fta: ftaQ,
    rbd: rsys,
    durationMs: Date.now() - started,
  };
}
