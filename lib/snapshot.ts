import type { DatabaseSync } from "node:sqlite";

/**
 * A frozen, self-contained copy of every derived table for one project.
 * Reports are always generated from a snapshot, never from live tables, so a
 * reviewer and an analyst can never disagree about what a report said.
 */
export type Snapshot = {
  generated_at: string;
  project: any;
  rev: number;
  modules: string[];
  pbs: any[];
  mttr: any[];
  fmea: any[];
  pm: any[];
  spares: any[];
  hazards: any[];
  fta: any;
  rbd: any;
};

export function snapshotProject(db: DatabaseSync, projectId: string, modules: string[]): Snapshot {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (!project) throw new Error("Project not found");

  const pbs = db
    .prepare(
      `SELECT n.*, p.name AS parent_name
         FROM pbs_nodes n LEFT JOIN pbs_nodes p ON p.id = n.parent_id
        WHERE n.project_id = ?
        ORDER BY n.depth, n.sort_order, n.name`,
    )
    .all(projectId) as any[];

  const mttr = db
    .prepare(
      `SELECT r.*, n.name AS node_name,
              (SELECT COALESCE(SUM(minutes), 0) FROM mttr_steps s WHERE s.mttr_record_id = r.id) AS total_minutes,
              (SELECT json_group_array(json_object('phase', s.phase, 'description', s.description, 'minutes', s.minutes))
                 FROM mttr_steps s WHERE s.mttr_record_id = r.id) AS steps
         FROM mttr_records r JOIN pbs_nodes n ON n.id = r.pbs_node_id
        WHERE r.project_id = ? ORDER BY n.name`,
    )
    .all(projectId) as any[];

  const fmea = db
    .prepare(
      `SELECT f.*, n.name AS node_name, n.part_number
         FROM fmea_rows f JOIN pbs_nodes n ON n.id = f.pbs_node_id
        WHERE f.project_id = ?
        ORDER BY f.kind, COALESCE(f.cr_rank, 9999), COALESCE(f.rpn, 0) DESC`,
    )
    .all(projectId) as any[];

  const pm = db
    .prepare(
      `SELECT m.*, n.name AS node_name
         FROM maintenance_tasks m JOIN pbs_nodes n ON n.id = m.pbs_node_id
        WHERE m.project_id = ? ORDER BY m.next_due_at`,
    )
    .all(projectId) as any[];

  const spares = db
    .prepare(
      `SELECT s.*, n.name AS node_name, n.part_number, n.quantity AS node_quantity,
              f.lambda_per_hour AS lambda
         FROM spare_items s JOIN pbs_nodes n ON n.id = s.pbs_node_id
         LEFT JOIN failure_rates f ON f.pbs_node_id = n.id
        WHERE s.project_id = ? ORDER BY n.name`,
    )
    .all(projectId) as any[];

  const hazards = db
    .prepare(
      `SELECT h.*, n.name AS node_name
         FROM hazards h LEFT JOIN pbs_nodes n ON n.id = h.pbs_node_id
        WHERE h.project_id = ? ORDER BY h.severity DESC, h.likelihood DESC`,
    )
    .all(projectId) as any[];

  const tree = db
    .prepare("SELECT * FROM fault_trees WHERE project_id = ? ORDER BY created_at LIMIT 1")
    .get(projectId) as any;
  const fta = tree
    ? {
        ...tree,
        nodes: db
          .prepare("SELECT * FROM fault_tree_nodes WHERE tree_id = ? ORDER BY sort_order")
          .all(tree.id),
      }
    : null;

  const model = db
    .prepare("SELECT * FROM rbd_models WHERE project_id = ? ORDER BY created_at LIMIT 1")
    .get(projectId) as any;
  const rbd = model
    ? {
        ...model,
        blocks: db
          .prepare("SELECT * FROM rbd_blocks WHERE model_id = ? ORDER BY sort_order")
          .all(model.id),
      }
    : null;

  return {
    generated_at: new Date().toISOString(),
    project,
    rev: project.rev,
    modules,
    pbs,
    mttr,
    fmea,
    pm,
    spares,
    hazards,
    fta,
    rbd,
  };
}
