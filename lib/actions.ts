"use server";

import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { clearSession, requireProject, setActiveProject, setSession, type ProjectContext } from "@/lib/session";
import { recomputeProject } from "@/lib/recompute";
import { bundleModules, moduleHref, MODULE_LIST, type ModuleKey } from "@/lib/constants";
import { snapshotProject } from "@/lib/snapshot";
import { addInterval } from "@/lib/format";
import { normalizeWorkspaceState } from "@/lib/workspace/store";

/* ------------------------------------------------------------------ helpers */

function str(fd: FormData, key: string, fallback = ""): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : fallback;
}

function num(fd: FormData, key: string, fallback = 0): number {
  const v = fd.get(key);
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function optNum(fd: FormData, key: string): number | null {
  const v = fd.get(key);
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "1" || v === "true";
}

function audit(
  db: ReturnType<typeof getDb>,
  companyId: string,
  projectId: string | null,
  actorId: string,
  entity: string,
  entityId: string,
  action: string,
  detail: string,
) {
  db.prepare(
    `INSERT INTO audit_events (company_id, project_id, actor_id, entity, entity_id, action, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(companyId, projectId, actorId, entity, entityId, action, detail);
}

function touch(ctx: ProjectContext, module: string) {
  recomputeProject(ctx.db, ctx.project.id);
  revalidatePath(moduleHref(module));
  revalidatePath("/projects");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/* ------------------------------------------------------------------ auth */

export async function signInAction(formData: FormData) {
  const email = str(formData, "email").toLowerCase();
  const password = str(formData, "password");
  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE lower(email) = ?").get(email) as any;
  if (!user || !verifyPassword(password, user.password_hash)) {
    redirect(`/login?error=1&email=${encodeURIComponent(email)}`);
  }
  await setSession(user.id);
  audit(db, user.company_id, null, user.id, "user", user.id, "login", "Signed in");
  redirect("/projects");
}

export async function signOutAction() {
  await clearSession();
  redirect("/login");
}

/* ------------------------------------------------------------------ projects */

export async function createProjectAction(formData: FormData) {
  const db = getDb();
  const user = (await requireProjectForUser()) as any;
  const name = str(formData, "name");
  if (!name) throw new Error("Project name is required.");
  const bundle = str(formData, "bundle", "full_suite");
  const id = `prj-${randomUUID()}`;
  const companyId = user.company_id;

  db.prepare(
    `INSERT INTO projects (id, company_id, name, code, customer, timezone, licensed_bundle, mission_hours, operating_hours, product_life_years)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    companyId,
    name,
    str(formData, "code") || null,
    str(formData, "customer") || null,
    str(formData, "timezone", "UTC") || "UTC",
    bundle,
    num(formData, "mission_hours", 8760),
    num(formData, "operating_hours", 8760),
    num(formData, "product_life_years", 10),
  );

  db.prepare("INSERT INTO project_members (project_id, user_id, role, module_grants) VALUES (?, ?, ?, '{}')").run(
    id,
    user.id,
    "company_admin",
  );

  for (const key of MODULE_LIST) {
    db.prepare(
      "INSERT INTO module_entitlements (project_id, module_key, enabled) VALUES (?, ?, ?)",
    ).run(id, key.key, bundleModules(bundle).includes(key.key as ModuleKey) ? 1 : 0);
  }

  db.prepare("INSERT INTO pbs_nodes (id, project_id, parent_id, level, name, part_number, depth, sort_order) VALUES (?, ?, NULL, 'system', ?, ?, 0, 0)").run(
    `n-${randomUUID()}`,
    id,
    name,
    str(formData, "code") || null,
  );

  audit(db, companyId, id, user.id, "project", id, "create", `Created project ${name}`);
  revalidatePath("/projects");
  await setActiveProject(id);
  redirect("/pbs?ok=created");
}

async function requireProjectForUser() {
  const { requireUser } = await import("@/lib/session");
  return requireUser();
}

function requireAdmin(ctx: ProjectContext) {
  if (ctx.role !== "company_admin" && ctx.role !== "super_admin") {
    throw new Error("Only a company admin can change project settings or membership.");
  }
}

export async function updateProjectAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  requireAdmin(ctx);
  const { db, project, user } = ctx;
  db.prepare(
    `UPDATE projects SET name = ?, code = ?, customer = ?, timezone = ?, mission_hours = ?,
            operating_hours = ?, product_life_years = ? WHERE id = ?`,
  ).run(
    str(formData, "name", project.name),
    str(formData, "code") || null,
    str(formData, "customer") || null,
    str(formData, "timezone", project.timezone),
    num(formData, "mission_hours", project.mission_hours),
    num(formData, "operating_hours", project.operating_hours),
    num(formData, "product_life_years", project.product_life_years),
    project.id,
  );
  audit(db, user.company_id, project.id, user.id, "project", project.id, "update", "Project settings updated");
  touch(ctx, "settings");
  await setActiveProject(project.id);
  redirect("/settings?ok=inputs");
}

export async function setBundleAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  requireAdmin(ctx);
  const bundle = str(formData, "bundle", "full_suite");
  const enabled = new Set(bundleModules(bundle));
  const { db, project, user } = ctx;
  for (const key of MODULE_LIST) {
    const exists = db
      .prepare("SELECT 1 AS x FROM module_entitlements WHERE project_id = ? AND module_key = ?")
      .get(project.id, key.key);
    if (exists) {
      db.prepare("UPDATE module_entitlements SET enabled = ? WHERE project_id = ? AND module_key = ?").run(
        enabled.has(key.key as ModuleKey) ? 1 : 0,
        project.id,
        key.key,
      );
    } else {
      db.prepare("INSERT INTO module_entitlements (project_id, module_key, enabled) VALUES (?, ?, ?)").run(
        project.id,
        key.key,
        enabled.has(key.key as ModuleKey) ? 1 : 0,
      );
    }
  }
  db.prepare("UPDATE projects SET licensed_bundle = ? WHERE id = ?").run(bundle, project.id);
  audit(db, user.company_id, project.id, user.id, "project", project.id, "update", `Licence changed to ${bundle}`);
  revalidatePath("/settings");
  await setActiveProject(project.id);
  redirect("/settings?ok=bundle");
}

export async function setProjectStatusAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  requireAdmin(ctx);
  const status = str(formData, "status", "active") === "archived" ? "archived" : "active";
  ctx.db.prepare("UPDATE projects SET status = ? WHERE id = ?").run(status, ctx.project.id);
  audit(ctx.db, ctx.user.company_id, ctx.project.id, ctx.user.id, "project", ctx.project.id, "update", `Project ${status}`);
  revalidatePath("/projects");
  if (status === "archived") redirect("/projects");
  await setActiveProject(ctx.project.id);
  redirect("/settings?ok=status");
}

/* ------------------------------------------------------------------ PBS */

export async function addPbsNodeAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("pbs");
  const { db, project, user } = ctx;
  const parentId = str(formData, "parentId") || null;
  const parent = parentId
    ? (db.prepare("SELECT * FROM pbs_nodes WHERE id = ? AND project_id = ?").get(parentId, project.id) as any)
    : null;
  if (parentId && !parent) throw new Error("Parent node not found.");
  const name = str(formData, "name");
  if (!name) throw new Error("Name is required.");
  const level = str(formData, "level") || (parent ? nextLevelOf(parent.level) : "system");
  const id = `n-${randomUUID()}`;
  const order = (db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM pbs_nodes WHERE project_id = ? AND COALESCE(parent_id, '') = ?")
    .get(project.id, parentId ?? "") as any).n;

  db.prepare(
    `INSERT INTO pbs_nodes (id, project_id, parent_id, level, name, part_number, quantity, category, location, depth, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    project.id,
    parentId,
    level,
    name,
    str(formData, "partNumber") || null,
    num(formData, "quantity", 1),
    str(formData, "category", "other") || "other",
    str(formData, "location") || null,
    parent ? parent.depth + 1 : 0,
    order,
  );
  audit(db, user.company_id, project.id, user.id, "pbs_node", id, "create", `Added ${level} ${name}`);
  touch(ctx, "pbs");
}

function nextLevelOf(level: string): string {
  const order = ["system", "subsystem", "assembly", "component"];
  const i = order.indexOf(level);
  return i < 0 ? "component" : order[Math.min(i + 1, order.length - 1)];
}

export async function updatePbsNodeAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("pbs");
  const { db, project, user } = ctx;
  const id = str(formData, "id");
  const node = db.prepare("SELECT * FROM pbs_nodes WHERE id = ? AND project_id = ?").get(id, project.id) as any;
  if (!node) throw new Error("Node not found.");

  const newParentId = str(formData, "parentId") || null;
  if (newParentId && newParentId !== node.parent_id) {
    if (newParentId === id) throw new Error("A node cannot be its own parent.");
    // reject a move under one of its own descendants
    let cursor: string | null = newParentId;
    while (cursor) {
      if (cursor === id) throw new Error("That move would create a cycle.");
      const row = db.prepare("SELECT parent_id FROM pbs_nodes WHERE id = ? AND project_id = ?").get(cursor, project.id) as any;
      cursor = row?.parent_id ?? null;
    }
    const parent = db.prepare("SELECT * FROM pbs_nodes WHERE id = ? AND project_id = ?").get(newParentId, project.id) as any;
    if (!parent) throw new Error("Parent not found.");
    db.prepare("UPDATE pbs_nodes SET parent_id = ?, depth = ?, sort_order = ? WHERE id = ?").run(
      newParentId,
      parent.depth + 1,
      num(formData, "sortOrder", node.sort_order),
      id,
    );
    reparentDepth(db, project.id, id, parent.depth + 1);
  }

  db.prepare(
    `UPDATE pbs_nodes SET name = ?, part_number = ?, quantity = ?, category = ?, location = ?,
            sort_order = ?, version = version + 1 WHERE id = ?`,
  ).run(
    str(formData, "name", node.name),
    str(formData, "partNumber") || null,
    num(formData, "quantity", node.quantity),
    str(formData, "category", node.category),
    str(formData, "location") || null,
    num(formData, "sortOrder", node.sort_order),
    id,
  );
  audit(db, user.company_id, project.id, user.id, "pbs_node", id, "update", `Updated ${node.name}`);
  touch(ctx, "pbs");
}

function reparentDepth(db: ReturnType<typeof getDb>, projectId: string, rootId: string, rootDepth: number) {
  const queue: { id: string; depth: number }[] = [{ id: rootId, depth: rootDepth }];
  const update = db.prepare("UPDATE pbs_nodes SET depth = ? WHERE id = ? AND project_id = ?");
  while (queue.length) {
    const current = queue.shift()!;
    update.run(current.depth, current.id, projectId);
    const children = db
      .prepare("SELECT id FROM pbs_nodes WHERE parent_id = ? AND project_id = ?")
      .all(current.id, projectId) as any[];
    for (const child of children) queue.push({ id: child.id, depth: current.depth + 1 });
  }
}

export async function deletePbsNodeAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("pbs");
  const { db, project, user } = ctx;
  const id = str(formData, "id");
  const node = db.prepare("SELECT * FROM pbs_nodes WHERE id = ? AND project_id = ?").get(id, project.id) as any;
  if (!node) return;
  db.prepare("DELETE FROM pbs_nodes WHERE id = ? AND project_id = ?").run(id, project.id);
  audit(db, user.company_id, project.id, user.id, "pbs_node", id, "delete", `Deleted ${node.name} and its subtree`);
  touch(ctx, "pbs");
}

/* ------------------------------------------------------------------ MTTR */

export async function addFmeaRowAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  const kind = str(formData, "kind", "fmeca") === "dfmea" ? "dfmea" : "fmeca";
  ctx.requireWrite(kind);
  const { db, project, user } = ctx;
  const nodeId = str(formData, "nodeId");
  if (!nodeId) throw new Error("Pick a component first.");
  const mode = str(formData, "failureMode");
  if (!mode) throw new Error("A failure mode is required.");
  const id = `fm-${randomUUID()}`;

  db.prepare(
    `INSERT INTO fmea_rows
      (id, project_id, pbs_node_id, kind, failure_mode, cause, local_effect, system_effect, end_effect,
       severity, occurrence, detection, alpha, beta, mission_t, action, action_owner)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    project.id,
    nodeId,
    kind,
    mode,
    str(formData, "cause") || null,
    str(formData, "localEffect") || null,
    str(formData, "systemEffect") || null,
    str(formData, "endEffect") || null,
    kind === "dfmea" ? Math.min(10, Math.max(1, num(formData, "severity", 5))) : null,
    kind === "dfmea" ? Math.min(10, Math.max(1, num(formData, "occurrence", 5))) : null,
    kind === "dfmea" ? Math.min(10, Math.max(1, num(formData, "detection", 5))) : null,
    kind === "fmeca" ? Math.min(1, Math.max(0, num(formData, "alpha", 0.5))) : null,
    kind === "fmeca" ? Math.min(1, Math.max(0, num(formData, "beta", 1))) : null,
    kind === "fmeca" ? num(formData, "missionT", project.operating_hours * project.product_life_years) : null,
    str(formData, "action") || null,
    str(formData, "actionOwner") || null,
  );
  audit(db, user.company_id, project.id, user.id, kind, id, "create", `Added failure mode "${mode}"`);
  touch(ctx, kind);
}

export async function saveFmeaRowsAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  const kind = str(formData, "kind", "fmeca") === "dfmea" ? "dfmea" : "fmeca";
  ctx.requireWrite(kind);
  const { db, project, user } = ctx;
  const rows = db.prepare("SELECT id FROM fmea_rows WHERE project_id = ? AND kind = ?").all(project.id, kind) as any[];
  for (const row of rows) {
    if (formData.get(`mode_${row.id}`) === null) continue;
    if (kind === "fmeca") {
      db.prepare(
        `UPDATE fmea_rows SET failure_mode = ?, cause = ?, local_effect = ?, end_effect = ?,
                alpha = ?, beta = ?, mission_t = ?, action = ?, action_owner = ?, version = version + 1
          WHERE id = ? AND project_id = ?`,
      ).run(
        str(formData, `mode_${row.id}`),
        str(formData, `cause_${row.id}`) || null,
        str(formData, `local_${row.id}`) || null,
        str(formData, `end_${row.id}`) || null,
        Math.min(1, Math.max(0, num(formData, `alpha_${row.id}`, 0.5))),
        Math.min(1, Math.max(0, num(formData, `beta_${row.id}`, 1))),
        Math.max(0, num(formData, `t_${row.id}`, 87600)),
        str(formData, `action_${row.id}`) || null,
        str(formData, `owner_${row.id}`) || null,
        row.id,
        project.id,
      );
    } else {
      db.prepare(
        `UPDATE fmea_rows SET failure_mode = ?, cause = ?, local_effect = ?, end_effect = ?,
                severity = ?, occurrence = ?, detection = ?, action = ?, action_owner = ?, version = version + 1
          WHERE id = ? AND project_id = ?`,
      ).run(
        str(formData, `mode_${row.id}`),
        str(formData, `cause_${row.id}`) || null,
        str(formData, `local_${row.id}`) || null,
        str(formData, `end_${row.id}`) || null,
        Math.min(10, Math.max(1, num(formData, `sev_${row.id}`, 5))),
        Math.min(10, Math.max(1, num(formData, `occ_${row.id}`, 5))),
        Math.min(10, Math.max(1, num(formData, `det_${row.id}`, 5))),
        str(formData, `action_${row.id}`) || null,
        str(formData, `owner_${row.id}`) || null,
        row.id,
        project.id,
      );
    }
  }
  audit(db, user.company_id, project.id, user.id, kind, project.id, "update", `${kind.toUpperCase()} grid saved`);
  touch(ctx, kind);
}

export async function deleteFmeaRowAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  const kind = str(formData, "kind", "fmeca") === "dfmea" ? "dfmea" : "fmeca";
  ctx.requireWrite(kind);
  const id = str(formData, "id");
  ctx.db.prepare("DELETE FROM fmea_rows WHERE id = ? AND project_id = ?").run(id, ctx.project.id);
  audit(ctx.db, ctx.user.company_id, ctx.project.id, ctx.user.id, kind, id, "delete", "Failure mode deleted");
  touch(ctx, kind);
}

/* ------------------------------------------------------------------ PM */

export async function addMaintenanceTaskAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("pm");
  const { db, project, user } = ctx;
  const nodeId = str(formData, "nodeId");
  if (!nodeId) throw new Error("Pick a component first.");
  const id = `pm-${randomUUID()}`;
  const lastDone = str(formData, "lastDone") || null;
  db.prepare(
    `INSERT INTO maintenance_tasks (id, project_id, pbs_node_id, description, strategy, interval_value, interval_unit, manpower, last_done_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    project.id,
    nodeId,
    str(formData, "description"),
    str(formData, "strategy", "time"),
    Math.max(0.01, num(formData, "intervalValue", 90)),
    str(formData, "intervalUnit", "days"),
    Math.max(1, num(formData, "manpower", 1)),
    lastDone,
  );
  audit(db, user.company_id, project.id, user.id, "maintenance_task", id, "create", "Maintenance task added");
  touch(ctx, "pm");
}

export async function saveMaintenanceTasksAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("pm");
  const { db, project, user } = ctx;
  const tasks = db.prepare("SELECT id FROM maintenance_tasks WHERE project_id = ?").all(project.id) as any[];
  for (const task of tasks) {
    if (formData.get(`desc_${task.id}`) === null) continue;
    db.prepare(
      `UPDATE maintenance_tasks SET description = ?, strategy = ?, interval_value = ?, interval_unit = ?,
              manpower = ?, last_done_at = ?, version = version + 1
        WHERE id = ? AND project_id = ?`,
    ).run(
      str(formData, `desc_${task.id}`),
      str(formData, `strategy_${task.id}`, "time"),
      Math.max(0.01, num(formData, `interval_${task.id}`, 90)),
      str(formData, `unit_${task.id}`, "days"),
      Math.max(1, num(formData, `manpower_${task.id}`, 1)),
      str(formData, `last_${task.id}`) || null,
      task.id,
      project.id,
    );
  }
  audit(db, user.company_id, project.id, user.id, "maintenance_task", project.id, "update", "Maintenance plan saved");
  touch(ctx, "pm");
}

export async function completeMaintenanceTaskAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("pm");
  const id = str(formData, "id");
  const task = ctx.db.prepare("SELECT * FROM maintenance_tasks WHERE id = ? AND project_id = ?").get(id, ctx.project.id) as any;
  if (!task) return;
  const next = addInterval(new Date(), task.interval_value, task.interval_unit);
  ctx.db.prepare(
    "UPDATE maintenance_tasks SET last_done_at = ?, next_due_at = ?, version = version + 1 WHERE id = ?",
  ).run(new Date().toISOString(), next.toISOString(), id);
  audit(ctx.db, ctx.user.company_id, ctx.project.id, ctx.user.id, "maintenance_task", id, "update", "Task marked complete");
  touch(ctx, "pm");
}

export async function deleteMaintenanceTaskAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("pm");
  const id = str(formData, "id");
  ctx.db.prepare("DELETE FROM maintenance_tasks WHERE id = ? AND project_id = ?").run(id, ctx.project.id);
  audit(ctx.db, ctx.user.company_id, ctx.project.id, ctx.user.id, "maintenance_task", id, "delete", "Maintenance task deleted");
  touch(ctx, "pm");
}

export async function generatePmFromFmecaAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("pm");
  const { db, project, user } = ctx;
  const rows = db
    .prepare(
      `SELECT f.*, n.name AS node_name FROM fmea_rows f JOIN pbs_nodes n ON n.id = f.pbs_node_id
        WHERE f.project_id = ? AND f.kind = 'fmeca' AND f.action IS NOT NULL
        ORDER BY f.cm DESC`,
    )
    .all(project.id) as any[];
  let created = 0;
  for (const row of rows) {
    const exists = db
      .prepare("SELECT 1 AS x FROM maintenance_tasks WHERE project_id = ? AND fmea_row_id = ?")
      .get(project.id, row.id);
    if (exists) continue;
    const interval = row.cm && row.cm > 0.05 ? 90 : row.cm && row.cm > 0.01 ? 180 : 365;
    db.prepare(
      `INSERT INTO maintenance_tasks (id, project_id, pbs_node_id, fmea_row_id, description, strategy, interval_value, interval_unit, manpower, last_done_at)
       VALUES (?, ?, ?, ?, ?, 'time', ?, 'days', 1, ?)`,
    ).run(
      `pm-${randomUUID()}`,
      project.id,
      row.pbs_node_id,
      row.id,
      `Inspect ${row.node_name} for ${String(row.failure_mode).toLowerCase()}`,
      interval,
      new Date().toISOString(),
    );
    created++;
  }
  audit(db, user.company_id, project.id, user.id, "maintenance_task", project.id, "create", `Generated ${created} tasks from FMECA`);
  touch(ctx, "pm");
}

/* ------------------------------------------------------------------ spares */

export async function saveSpareItemsAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("spares");
  const { db, project, user } = ctx;
  const items = db.prepare("SELECT id FROM spare_items WHERE project_id = ?").all(project.id) as any[];
  for (const item of items) {
    if (formData.get(`onhand_${item.id}`) === null) continue;
    db.prepare(
      `UPDATE spare_items SET qty_on_hand = ?, lead_time_days = ?, moq = ?, unit_cost_cents = ?,
              service_level = ?, version = version + 1 WHERE id = ? AND project_id = ?`,
    ).run(
      Math.max(0, num(formData, `onhand_${item.id}`, 0)),
      Math.max(0, num(formData, `lead_${item.id}`, 30)),
      Math.max(1, num(formData, `moq_${item.id}`, 1)),
      Math.max(0, Math.round(num(formData, `cost_${item.id}`, 0) * 100)),
      Math.min(0.9999, Math.max(0.5, num(formData, `service_${item.id}`, 0.95))),
      item.id,
      project.id,
    );
  }
  audit(db, user.company_id, project.id, user.id, "spare_item", project.id, "update", "Spares plan saved");
  touch(ctx, "spares");
}

export async function addSpareItemAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("spares");
  const { db, project, user } = ctx;
  const nodeId = str(formData, "nodeId");
  if (!nodeId) throw new Error("Pick a component first.");
  const id = `sp-${randomUUID()}`;
  db.prepare(
    `INSERT INTO spare_items (id, project_id, pbs_node_id, qty_on_hand, lead_time_days, moq, unit_cost_cents, service_level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(pbs_node_id) DO UPDATE SET
       qty_on_hand = excluded.qty_on_hand, lead_time_days = excluded.lead_time_days,
       moq = excluded.moq, unit_cost_cents = excluded.unit_cost_cents,
       service_level = excluded.service_level, version = version + 1`,
  ).run(
    id,
    project.id,
    nodeId,
    Math.max(0, num(formData, "qtyOnHand", 0)),
    Math.max(0, num(formData, "leadTimeDays", 30)),
    Math.max(1, num(formData, "moq", 1)),
    Math.max(0, Math.round(num(formData, "unitCost", 0) * 100)),
    Math.min(0.9999, Math.max(0.5, num(formData, "serviceLevel", 0.95))),
  );
  audit(db, user.company_id, project.id, user.id, "spare_item", nodeId, "create", "Spare item added");
  touch(ctx, "spares");
}

export async function deleteSpareItemAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("spares");
  const id = str(formData, "id");
  ctx.db.prepare("DELETE FROM spare_items WHERE id = ? AND project_id = ?").run(id, ctx.project.id);
  audit(ctx.db, ctx.user.company_id, ctx.project.id, ctx.user.id, "spare_item", id, "delete", "Spare item deleted");
  touch(ctx, "spares");
}

/* ------------------------------------------------------------------ safety */

function parseControls(raw: string): any[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [maybeLevel, ...rest] = line.split(":");
      const level = rest.length && ["design", "procedure", "training", "warning", "ppe"].includes(maybeLevel.trim().toLowerCase())
        ? maybeLevel.trim()
        : "Control";
      const control = rest.length && level !== "Control" ? rest.join(":").trim() : line;
      return { level, control, verified_at: null };
    });
}

export async function addHazardAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("safety");
  const { db, project, user } = ctx;
  const description = str(formData, "description");
  if (!description) throw new Error("A hazard description is required.");
  const id = `hz-${randomUUID()}`;
  db.prepare(
    `INSERT INTO hazards (id, project_id, pbs_node_id, description, severity, likelihood, controls,
                          residual_severity, residual_likelihood)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    project.id,
    str(formData, "nodeId") || null,
    description,
    Math.min(4, Math.max(1, num(formData, "severity", 3))),
    Math.min(5, Math.max(1, num(formData, "likelihood", 3))),
    JSON.stringify(parseControls(str(formData, "controls"))),
    optNum(formData, "residualSeverity"),
    optNum(formData, "residualLikelihood"),
  );
  audit(db, user.company_id, project.id, user.id, "hazard", id, "create", `Hazard logged: ${description}`);
  touch(ctx, "safety");
}

export async function saveHazardsAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("safety");
  const { db, project, user } = ctx;
  const hazards = db.prepare("SELECT id FROM hazards WHERE project_id = ?").all(project.id) as any[];
  for (const hazard of hazards) {
    if (formData.get(`desc_${hazard.id}`) === null) continue;
    db.prepare(
      `UPDATE hazards SET description = ?, severity = ?, likelihood = ?, controls = ?,
              residual_severity = ?, residual_likelihood = ?, version = version + 1
        WHERE id = ? AND project_id = ?`,
    ).run(
      str(formData, `desc_${hazard.id}`),
      Math.min(4, Math.max(1, num(formData, `sev_${hazard.id}`, 3))),
      Math.min(5, Math.max(1, num(formData, `lik_${hazard.id}`, 3))),
      JSON.stringify(parseControls(str(formData, `controls_${hazard.id}`))),
      optNum(formData, `rsev_${hazard.id}`),
      optNum(formData, `rlik_${hazard.id}`),
      hazard.id,
      project.id,
    );
  }
  audit(db, user.company_id, project.id, user.id, "hazard", project.id, "update", "Hazard register saved");
  touch(ctx, "safety");
}

export async function deleteHazardAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("safety");
  const id = str(formData, "id");
  ctx.db.prepare("DELETE FROM hazards WHERE id = ? AND project_id = ?").run(id, ctx.project.id);
  audit(ctx.db, ctx.user.company_id, ctx.project.id, ctx.user.id, "hazard", id, "delete", "Hazard deleted");
  touch(ctx, "safety");
}

/* ------------------------------------------------------------------ FTA */

export async function ensureFaultTreeAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("fta");
  const { db, project, user } = ctx;
  const existing = db.prepare("SELECT id FROM fault_trees WHERE project_id = ?").get(project.id);
  if (existing) return;
  const treeId = `ft-${randomUUID()}`;
  db.prepare(
    "INSERT INTO fault_trees (id, project_id, name, top_label, mission_hours) VALUES (?, ?, ?, ?, ?)",
  ).run(treeId, project.id, "Top event", "Top event", project.mission_hours);
  db.prepare(
    "INSERT INTO fault_tree_nodes (id, project_id, tree_id, parent_id, node_type, gate_type, label, sort_order) VALUES (?, ?, ?, NULL, 'gate', 'or', 'Top event', 0)",
  ).run(`ftn-${randomUUID()}`, project.id, treeId);
  audit(db, user.company_id, project.id, user.id, "fault_tree", treeId, "create", "Fault tree created");
  touch(ctx, "fta");
}

export async function addFtaNodeAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("fta");
  const { db, project, user } = ctx;
  const treeId = str(formData, "treeId");
  const tree = db.prepare("SELECT * FROM fault_trees WHERE id = ? AND project_id = ?").get(treeId, project.id) as any;
  if (!tree) throw new Error("Tree not found.");
  const parentId = str(formData, "parentId") || null;
  if (parentId) {
    const parent = db.prepare("SELECT * FROM fault_tree_nodes WHERE id = ? AND tree_id = ?").get(parentId, treeId) as any;
    if (!parent) throw new Error("Parent gate not found.");
    if (parent.node_type !== "gate") throw new Error("A basic event cannot have children.");
  }
  const nodeType = str(formData, "nodeType", "event") === "gate" ? "gate" : "event";
  const order = (db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM fault_tree_nodes WHERE tree_id = ? AND COALESCE(parent_id, '') = ?")
    .get(treeId, parentId ?? "") as any).n;
  const id = `ftn-${randomUUID()}`;
  db.prepare(
    `INSERT INTO fault_tree_nodes (id, project_id, tree_id, parent_id, node_type, gate_type, gate_k, pbs_node_id, label, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    project.id,
    treeId,
    parentId,
    nodeType,
    nodeType === "gate" ? str(formData, "gateType", "or") : null,
    nodeType === "gate" && str(formData, "gateType") === "voting" ? Math.max(1, num(formData, "gateK", 2)) : null,
    nodeType === "event" ? str(formData, "pbsNodeId") || null : null,
    str(formData, "label", nodeType === "gate" ? "New gate" : "New event"),
    order,
  );
  audit(db, user.company_id, project.id, user.id, "fault_tree_node", id, "create", `Added ${nodeType}`);
  touch(ctx, "fta");
}

export async function saveFtaNodesAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("fta");
  const { db, project, user } = ctx;
  const treeId = str(formData, "treeId");
  const tree = db.prepare("SELECT * FROM fault_trees WHERE id = ? AND project_id = ?").get(treeId, project.id) as any;
  if (!tree) return;
  db.prepare("UPDATE fault_trees SET name = ?, top_label = ?, mission_hours = ?, version = version + 1 WHERE id = ?").run(
    str(formData, "treeName", tree.name),
    str(formData, "topLabel", tree.top_label ?? ""),
    Math.max(1, num(formData, "missionHours", tree.mission_hours)),
    treeId,
  );
  const nodes = db.prepare("SELECT id, node_type FROM fault_tree_nodes WHERE tree_id = ?").all(treeId) as any[];
  for (const node of nodes) {
    if (formData.get(`label_${node.id}`) === null) continue;
    if (node.node_type === "gate") {
      db.prepare(
        "UPDATE fault_tree_nodes SET label = ?, gate_type = ?, gate_k = ?, sort_order = ? WHERE id = ?",
      ).run(
        str(formData, `label_${node.id}`),
        str(formData, `gate_${node.id}`, "or"),
        optNum(formData, `k_${node.id}`),
        num(formData, `order_${node.id}`, 0),
        node.id,
      );
    } else {
      db.prepare(
        "UPDATE fault_tree_nodes SET label = ?, pbs_node_id = ?, probability = ?, sort_order = ? WHERE id = ?",
      ).run(
        str(formData, `label_${node.id}`),
        str(formData, `node_${node.id}`) || null,
        optNum(formData, `prob_${node.id}`),
        num(formData, `order_${node.id}`, 0),
        node.id,
      );
    }
  }
  audit(db, user.company_id, project.id, user.id, "fault_tree", treeId, "update", "Fault tree saved");
  touch(ctx, "fta");
}

export async function deleteFtaNodeAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("fta");
  const id = str(formData, "id");
  ctx.db.prepare("DELETE FROM fault_tree_nodes WHERE id = ? AND project_id = ?").run(id, ctx.project.id);
  audit(ctx.db, ctx.user.company_id, ctx.project.id, ctx.user.id, "fault_tree_node", id, "delete", "Tree node deleted");
  touch(ctx, "fta");
}

/* ------------------------------------------------------------------ RBD */

export async function ensureRbdModelAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("rbd");
  const { db, project, user } = ctx;
  const existing = db.prepare("SELECT id FROM rbd_models WHERE project_id = ?").get(project.id);
  if (existing) return;
  const id = `rbd-${randomUUID()}`;
  db.prepare("INSERT INTO rbd_models (id, project_id, name, mission_hours) VALUES (?, ?, ?, ?)").run(
    id,
    project.id,
    "System reliability",
    project.mission_hours,
  );
  audit(db, user.company_id, project.id, user.id, "rbd_model", id, "create", "RBD model created");
  touch(ctx, "rbd");
}

export async function addRbdBlockAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("rbd");
  const { db, project, user } = ctx;
  const modelId = str(formData, "modelId");
  const model = db.prepare("SELECT * FROM rbd_models WHERE id = ? AND project_id = ?").get(modelId, project.id) as any;
  if (!model) throw new Error("RBD model not found.");
  const order = (db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM rbd_blocks WHERE model_id = ?").get(modelId) as any).n;
  const id = `rb-${randomUUID()}`;
  db.prepare(
    `INSERT INTO rbd_blocks (id, project_id, model_id, pbs_node_id, label, reliability, group_key, group_type, group_k, group_n, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    project.id,
    modelId,
    str(formData, "pbsNodeId") || null,
    str(formData, "label", "Block"),
    Math.min(1, Math.max(0, num(formData, "reliability", 0.99))),
    str(formData, "groupKey", "stage-1") || "stage-1",
    str(formData, "groupType", "series"),
    str(formData, "groupType") === "k_out_of_n" ? Math.max(1, num(formData, "groupK", 1)) : null,
    str(formData, "groupType") === "k_out_of_n" ? Math.max(1, num(formData, "groupN", 2)) : null,
    order,
  );
  audit(db, user.company_id, project.id, user.id, "rbd_block", id, "create", "Block added");
  touch(ctx, "rbd");
}

export async function saveRbdBlocksAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("rbd");
  const { db, project, user } = ctx;
  const modelId = str(formData, "modelId");
  const model = db.prepare("SELECT * FROM rbd_models WHERE id = ? AND project_id = ?").get(modelId, project.id) as any;
  if (!model) return;
  db.prepare("UPDATE rbd_models SET name = ?, mission_hours = ?, version = version + 1 WHERE id = ?").run(
    str(formData, "modelName", model.name),
    Math.max(1, num(formData, "missionHours", model.mission_hours)),
    modelId,
  );
  const blocks = db.prepare("SELECT id FROM rbd_blocks WHERE model_id = ?").all(modelId) as any[];
  for (const block of blocks) {
    if (formData.get(`label_${block.id}`) === null) continue;
    const groupType = str(formData, `gtype_${block.id}`, "series");
    db.prepare(
      `UPDATE rbd_blocks SET label = ?, pbs_node_id = ?, reliability = ?, group_key = ?, group_type = ?,
              group_k = ?, group_n = ?, sort_order = ? WHERE id = ?`,
    ).run(
      str(formData, `label_${block.id}`),
      str(formData, `node_${block.id}`) || null,
      Math.min(1, Math.max(0, num(formData, `rel_${block.id}`, 0.99))),
      str(formData, `group_${block.id}`, "stage-1") || "stage-1",
      groupType,
      groupType === "k_out_of_n" ? Math.max(1, num(formData, `gk_${block.id}`, 1)) : null,
      groupType === "k_out_of_n" ? Math.max(1, num(formData, `gn_${block.id}`, 2)) : null,
      num(formData, `order_${block.id}`, 0),
      block.id,
    );
  }
  audit(db, user.company_id, project.id, user.id, "rbd_model", modelId, "update", "RBD saved");
  touch(ctx, "rbd");
}

export async function deriveRbdReliabilityAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("rbd");
  const { db, project, user } = ctx;
  const modelId = str(formData, "modelId");
  const model = db.prepare("SELECT * FROM rbd_models WHERE id = ? AND project_id = ?").get(modelId, project.id) as any;
  if (!model) return;
  const blocks = db.prepare("SELECT * FROM rbd_blocks WHERE model_id = ?").all(modelId) as any[];
  const rates = db.prepare("SELECT pbs_node_id, lambda_per_hour FROM failure_rates WHERE project_id = ?").all(project.id) as any[];
  const lambdaBy = new Map(rates.map((r) => [r.pbs_node_id, r.lambda_per_hour]));
  const hours = model.mission_hours || project.mission_hours;
  let updated = 0;
  for (const block of blocks) {
    const lambda = block.pbs_node_id ? (lambdaBy.get(block.pbs_node_id) as number) : null;
    if (lambda == null) continue;
    db.prepare("UPDATE rbd_blocks SET reliability = ? WHERE id = ?").run(Math.exp(-lambda * hours), block.id);
    updated++;
  }
  audit(db, user.company_id, project.id, user.id, "rbd_block", modelId, "update", `Derived mission reliability for ${updated} blocks from register λ`);
  touch(ctx, "rbd");
}

export async function deleteRbdBlockAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("rbd");
  const id = str(formData, "id");
  ctx.db.prepare("DELETE FROM rbd_blocks WHERE id = ? AND project_id = ?").run(id, ctx.project.id);
  audit(ctx.db, ctx.user.company_id, ctx.project.id, ctx.user.id, "rbd_block", id, "delete", "RBD block deleted");
  touch(ctx, "rbd");
}

/* ------------------------------------------------------------------ data register */

export type DataRegisterSaveRow = {
  id: string;
  tag: string;
  description: string;
  systemId: string | null;
  qty: number;
  lambda: number;
  mttr: number;
};

function finiteNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * The register edits the PBS component line, its failure rate and its MTTR
 * record in one pass. Permission is checked against every touched module, so
 * a register write can never be used to bypass a restricted module.
 */
export async function saveDataRegisterAction(input: {
  projectId: string;
  rows: DataRegisterSaveRow[];
}): Promise<{ ok: true; created: number; updated: number }> {
  const ctx = await requireProject(String(input?.projectId ?? ""));
  ctx.requireWrite("register");
  ctx.requireWrite("pbs");
  const { db, project, user } = ctx;

  const rows = Array.isArray(input?.rows) ? input.rows : [];
  if (rows.length > 500) throw new Error("Save at most 500 register rows at a time.");

  const findNode = db.prepare("SELECT * FROM pbs_nodes WHERE id = ? AND project_id = ?");
  const findParent = db.prepare("SELECT * FROM pbs_nodes WHERE id = ? AND project_id = ?");
  const nextOrder = db.prepare(
    "SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM pbs_nodes WHERE project_id = ? AND COALESCE(parent_id, '') = ?",
  );
  let created = 0;
  let updated = 0;

  for (const value of rows) {
    const id = String(value?.id ?? "");
    const description = String(value?.description ?? "").trim().slice(0, 200);
    if (!description) throw new Error("Every register row needs a description.");
    const tag = String(value?.tag ?? "").trim().slice(0, 120) || description;
    const qty = Math.max(0, finiteNumber(value?.qty, 1));
    const lambda = Math.max(0, finiteNumber(value?.lambda, 0));
    const mttr = Math.max(0, finiteNumber(value?.mttr, 0));

    let nodeId = id;
    const existing = id && !id.startsWith("new-") ? (findNode.get(id, project.id) as any) : null;

    if (existing) {
      if (existing.level !== "component") throw new Error("Only component lines can be saved from the register.");
      const parentId = String(value?.systemId ?? "") || null;
      const parent = parentId ? (findParent.get(parentId, project.id) as any) : null;
      db.prepare(
        `UPDATE pbs_nodes SET name = ?, part_number = ?, quantity = ?, parent_id = ?, depth = ?, version = version + 1
          WHERE id = ? AND project_id = ?`,
      ).run(description, tag, qty, parent?.id ?? null, parent ? parent.depth + 1 : 0, id, project.id);
      updated += 1;
    } else {
      nodeId = `n-${randomUUID()}`;
      const parentId = String(value?.systemId ?? "") || null;
      const parent = parentId ? (findParent.get(parentId, project.id) as any) : null;
      // A component cannot be nested under another component: climb to its parent.
      const resolved = parent?.level === "component" ? (findParent.get(parent.parent_id, project.id) as any) : parent;
      const order = (nextOrder.get(project.id, resolved?.id ?? "") as any).n;
      db.prepare(
        `INSERT INTO pbs_nodes (id, project_id, parent_id, level, name, part_number, quantity, category, location, depth, sort_order)
         VALUES (?, ?, ?, 'component', ?, ?, ?, 'other', NULL, ?, ?)`,
      ).run(
        nodeId,
        project.id,
        resolved?.id ?? null,
        description,
        tag,
        qty,
        resolved ? resolved.depth + 1 : 0,
        order,
      );
      created += 1;
    }

    db.prepare(
      `INSERT INTO failure_rates (pbs_node_id, project_id, method, lambda_per_hour, updated_at)
       VALUES (?, ?, 'manual', ?, datetime('now'))
       ON CONFLICT(pbs_node_id) DO UPDATE SET
         lambda_per_hour = excluded.lambda_per_hour,
         method = 'manual',
         updated_at = datetime('now')`,
    ).run(nodeId, project.id, lambda);

    db.prepare(
      `INSERT INTO mttr_records (id, project_id, pbs_node_id, repair_location, manpower, spares_available, mttr_hours)
       VALUES (?, ?, ?, 'workshop', 1, 1, ?)
       ON CONFLICT(pbs_node_id) DO UPDATE SET
         mttr_hours = excluded.mttr_hours,
         version = version + 1`,
    ).run(`mttr-${randomUUID()}`, project.id, nodeId, mttr);

    // MTTR is derived from the step minutes in the MTTR module, and the
    // recompute that follows this save would overwrite a bare mttr_hours write.
    // Scale the existing steps (or open a repair step) so the derived value is
    // the number the register was given and stays stable across recomputes.
    const record = db
      .prepare("SELECT id, manpower, spares_available FROM mttr_records WHERE pbs_node_id = ? AND project_id = ?")
      .get(nodeId, project.id) as any;
    if (record) {
      const manpower = Math.max(1, Number(record.manpower) || 1);
      const spare = db
        .prepare("SELECT lead_time_days FROM spare_items WHERE project_id = ? AND pbs_node_id = ?")
        .get(project.id, nodeId) as any;
      const delay = record.spares_available
        ? 0
        : Math.min(720, spare?.lead_time_days ? spare.lead_time_days * 24 : 8);
      const targetMinutes = Math.max(0, (mttr - delay) * manpower * 60);
      const steps = db
        .prepare("SELECT id, minutes FROM mttr_steps WHERE mttr_record_id = ? ORDER BY rowid")
        .all(record.id) as any[];
      if (!steps.length) {
        if (targetMinutes > 0) {
          db.prepare(
            "INSERT INTO mttr_steps (id, project_id, mttr_record_id, phase, description, minutes) VALUES (?, ?, ?, 'repair', 'Register repair time', ?)",
          ).run(`step-${randomUUID()}`, project.id, record.id, targetMinutes);
        }
      } else {
        const current = steps.reduce((sum, step) => sum + (Number(step.minutes) || 0), 0);
        const update = db.prepare("UPDATE mttr_steps SET minutes = ? WHERE id = ?");
        if (current > 0 && targetMinutes > 0) {
          let allocated = 0;
          steps.forEach((step, index) => {
            const minutes =
              index === steps.length - 1
                ? Math.max(0, targetMinutes - allocated)
                : Math.round(((Number(step.minutes) || 0) / current) * targetMinutes * 100) / 100;
            allocated += minutes;
            update.run(minutes, step.id);
          });
        } else if (targetMinutes === 0) {
          for (const step of steps) update.run(0, step.id);
        }
      }
    }
  }

  audit(
    db,
    user.company_id,
    project.id,
    user.id,
    "data_register",
    project.id,
    "update",
    `Register saved: ${created} created, ${updated} updated`,
  );
  touch(ctx, "register");
  revalidatePath("/pbs");
  return { ok: true, created, updated };
}

export async function deleteDataRegisterRowAction(input: {
  projectId: string;
  id: string;
}): Promise<{ ok: true }> {
  const ctx = await requireProject(String(input?.projectId ?? ""));
  ctx.requireWrite("register");
  ctx.requireWrite("pbs");
  const { db, project, user } = ctx;
  const id = String(input?.id ?? "");
  const node = db.prepare("SELECT * FROM pbs_nodes WHERE id = ? AND project_id = ?").get(id, project.id) as any;
  if (!node) return { ok: true };
  if (node.level !== "component") throw new Error("The register can only delete component lines.");
  db.prepare("DELETE FROM pbs_nodes WHERE id = ? AND project_id = ?").run(id, project.id);
  audit(db, user.company_id, project.id, user.id, "data_register", id, "delete", `Deleted component ${node.name}`);
  touch(ctx, "register");
  revalidatePath("/pbs");
  return { ok: true };
}

/* ------------------------------------------------------------------ diagram workspace */

/**
 * Autosave for the RBD / FTA canvas. The document is validated and rebuilt on
 * the server, so the browser can only ever store a known shape.
 */
export async function saveWorkspaceAction(input: {
  projectId: string;
  mode: "rbd" | "fta";
  state: unknown;
}): Promise<{ ok: true; savedAt: string }> {
  const mode = input?.mode === "fta" ? "fta" : "rbd";
  const ctx = await requireProject(String(input?.projectId ?? ""));
  ctx.requireWrite(mode);
  const { db, project } = ctx;

  const table = mode === "rbd" ? "rbd_models" : "fault_trees";
  const row = db
    .prepare(`SELECT mission_hours FROM ${table} WHERE project_id = ? ORDER BY created_at LIMIT 1`)
    .get(project.id) as any;
  const missionHours = Number(row?.mission_hours) || Number(project.mission_hours) || 8760;

  const state = normalizeWorkspaceState(input?.state, missionHours);
  db.prepare(
    `INSERT INTO diagram_workspaces (project_id, mode, state, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(project_id, mode) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
  ).run(project.id, mode, JSON.stringify(state));

  const savedAt = new Date().toISOString();
  return { ok: true, savedAt };
}

/* ------------------------------------------------------------------ reports */

async function buildReport(ctx: ProjectContext, modules: string[], label: string) {
  const { db, project, user } = ctx;
  const snapshot = snapshotProject(db, project.id, modules);
  const versionId = `ver-${randomUUID()}`;
  db.prepare(
    `INSERT INTO analysis_versions (id, project_id, rev, label, snapshot, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(versionId, project.id, project.rev, label, JSON.stringify(snapshot), user.id);
  const revision = (db.prepare("SELECT COALESCE(MAX(revision), 0) + 1 AS n FROM reports WHERE project_id = ?").get(project.id) as any).n;
  const reportId = `rep-${randomUUID()}`;
  const fileName = `${slug(project.name)}-rev${project.rev}-r${revision}.xlsx`;
  db.prepare(
    `INSERT INTO reports (id, project_id, version_id, modules, filters, format, status, file_name, revision, generated_by)
     VALUES (?, ?, ?, ?, '{}', 'xlsx', 'ready', ?, ?, ?)`,
  ).run(reportId, project.id, versionId, JSON.stringify(modules), fileName, revision, user.id);
  audit(db, user.company_id, project.id, user.id, "report", reportId, "export", `${label} generated from revision ${project.rev}`);
  return reportId;
}

export async function generateReportAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("reports");
  const modules = formData.getAll("modules").map((m) => String(m)).filter(Boolean);
  const chosen = modules.length ? modules : ["pbs", "register", "fmeca"];
  const label = str(formData, "label") || `Revision ${ctx.project.rev}`;
  await buildReport(ctx, chosen, label);
  revalidatePath("/reports");
  await setActiveProject(ctx.project.id);
  redirect("/reports?generated=1");
}

export async function regenerateReportAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("reports");
  const reportId = str(formData, "id");
  const report = ctx.db.prepare("SELECT * FROM reports WHERE id = ? AND project_id = ?").get(reportId, ctx.project.id) as any;
  if (!report) return;
  let modules: string[] = [];
  try {
    modules = JSON.parse(report.modules);
  } catch {
    modules = ["pbs", "register", "fmeca"];
  }
  await buildReport(ctx, modules, `Regenerated revision ${ctx.project.rev}`);
  revalidatePath("/reports");
  await setActiveProject(ctx.project.id);
  redirect("/reports?generated=1");
}

export async function deleteReportAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("reports");
  const id = str(formData, "id");
  ctx.db.prepare("DELETE FROM reports WHERE id = ? AND project_id = ?").run(id, ctx.project.id);
  audit(ctx.db, ctx.user.company_id, ctx.project.id, ctx.user.id, "report", id, "delete", "Report deleted");
  revalidatePath("/reports");
}

/* ------------------------------------------------------------------ members */

export async function inviteMemberAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  requireAdmin(ctx);
  const { db, project, user } = ctx;
  const email = str(formData, "email").toLowerCase();
  const name = str(formData, "name") || email.split("@")[0];
  const role = str(formData, "role", "employee");
  if (!email.includes("@")) throw new Error("A valid email is required.");
  let member = db.prepare("SELECT * FROM users WHERE lower(email) = ?").get(email) as any;
  if (member && member.company_id !== user.company_id) throw new Error("That email already belongs to another company.");
  if (!member) {
    const id = `u-${randomUUID()}`;
    db.prepare(
      "INSERT INTO users (id, company_id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, user.company_id, email, name, hashPassword("demo1234"), role);
    member = { id };
  }
  db.prepare(
    `INSERT INTO project_members (project_id, user_id, role, module_grants) VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role`,
  ).run(project.id, member.id, role, JSON.stringify({}));
  audit(db, user.company_id, project.id, user.id, "member", member.id, "create", `${name} added as ${role}`);
  revalidatePath("/settings");
  await setActiveProject(project.id);
  redirect("/settings?ok=invited");
}

export async function updateMemberAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  requireAdmin(ctx);
  const { db, project, user } = ctx;
  const userId = str(formData, "userId");
  const role = str(formData, "role", "employee");
  if (role !== "company_admin") {
    const admins = db
      .prepare("SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND role = 'company_admin'")
      .get(project.id) as any;
    const current = db
      .prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?")
      .get(project.id, userId) as any;
    if (current?.role === "company_admin" && admins.n <= 1) {
      throw new Error("A project must keep at least one Company Admin.");
    }
  }
  const grants: Record<string, string> = {};
  for (const module of MODULE_LIST) {
    const value = str(formData, `grant_${module.key}`, "none");
    if (value === "read" || value === "write") grants[module.key] = value;
  }
  db.prepare("UPDATE project_members SET role = ?, module_grants = ? WHERE project_id = ? AND user_id = ?").run(
    role,
    JSON.stringify(grants),
    project.id,
    userId,
  );
  audit(db, user.company_id, project.id, user.id, "member", userId, "update", `Role set to ${role}`);
  revalidatePath("/settings");
  await setActiveProject(project.id);
  redirect("/settings?ok=grants");
}

export async function removeMemberAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  requireAdmin(ctx);
  const { db, project, user } = ctx;
  const userId = str(formData, "userId");
  const current = db
    .prepare("SELECT * FROM project_members WHERE project_id = ? AND user_id = ?")
    .get(project.id, userId) as any;
  if (!current) return;
  if (current.role === "company_admin") {
    const admins = db
      .prepare("SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND role = 'company_admin'")
      .get(project.id) as any;
    if (admins.n <= 1) throw new Error("A project must keep at least one Company Admin.");
  }
  db.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").run(project.id, userId);
  audit(db, user.company_id, project.id, user.id, "member", userId, "delete", "Member removed from project");
  revalidatePath("/settings");
  await setActiveProject(project.id);
  redirect("/settings?ok=removed");
}

/* ------------------------------------------------------------------ import */

export async function importSpreadsheetAction(formData: FormData) {
  const ctx = await requireProject(str(formData, "projectId"));
  ctx.requireWrite("pbs");
  const { db, project, user } = ctx;
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose an .xlsx or .csv file first.");
  if (file.size > 10 * 1024 * 1024) throw new Error("The file is larger than 10 MB.");

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });

  const jobId = `imp-${randomUUID()}`;
  let ok = 0;
  let errors = 0;
  const messages: string[] = [];
  const byPath = new Map<string, string>();

  db.exec("BEGIN");
  try {
    for (const [index, row] of rows.entries()) {
      const name = String(row["Name"] ?? row["name"] ?? "").trim();
      if (!name) continue;
      const parentPath = String(row["Parent"] ?? row["parent"] ?? "").trim();
      const level = String(row["Level"] ?? row["level"] ?? "").trim().toLowerCase();
      const part = String(row["Part Number"] ?? row["PartNumber"] ?? "").trim();
      const qty = Number(row["Quantity"] ?? row["Qty"] ?? 1) || 1;
      const category = String(row["Category"] ?? "other").trim().toLowerCase();
      const lambda = Number(row["Lambda"] ?? row["Lambda per 1e6h"] ?? "");
      const validLevels = ["system", "subsystem", "assembly", "component"];
      const parentId = parentPath ? byPath.get(parentPath) : null;
      if (parentPath && !parentId) {
        errors++;
        messages.push(`Row ${index + 2}: parent path "${parentPath}" not found. Parents must appear first.`);
        continue;
      }
      const levelValue = validLevels.includes(level)
        ? level
        : parentId
          ? nextLevelOf((db.prepare("SELECT level FROM pbs_nodes WHERE id = ?").get(parentId) as any).level)
          : "system";
      const id = `n-${randomUUID()}`;
      const depth = parentId
        ? ((db.prepare("SELECT depth FROM pbs_nodes WHERE id = ?").get(parentId) as any)?.depth ?? 0) + 1
        : 0;
      const order = (db
        .prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM pbs_nodes WHERE project_id = ? AND COALESCE(parent_id, '') = ?")
        .get(project.id, parentId ?? "") as any).n;
      db.prepare(
        `INSERT INTO pbs_nodes (id, project_id, parent_id, level, name, part_number, quantity, category, depth, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, project.id, parentId, levelValue, name, part || null, qty, category || "other", depth, order);
      const path = parentPath ? `${parentPath} / ${name}` : name;
      byPath.set(path, id);
      if (Number.isFinite(lambda) && lambda >= 0 && String(row["Lambda"] ?? row["Lambda per 1e6h"] ?? "") !== "") {
        db.prepare(
          `INSERT INTO failure_rates (pbs_node_id, project_id, method, lambda_per_hour, source_ref, updated_at)
           VALUES (?, ?, 'imported', ?, ?, datetime('now'))`,
        ).run(id, project.id, lambda * 1e-6, `Imported from ${file.name}`);
      }
      ok++;
    }
    db.prepare(
      "INSERT INTO import_jobs (id, project_id, filename, status, rows_total, rows_ok, rows_error, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(jobId, project.id, file.name, errors > 0 ? "partial" : "committed", rows.length, ok, errors, JSON.stringify(messages.slice(0, 40)));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  audit(db, user.company_id, project.id, user.id, "import", jobId, "create", `Imported ${ok} rows from ${file.name}`);
  recomputeProject(db, project.id);
  revalidatePath("/pbs");
  revalidatePath("/data-register");
  await setActiveProject(project.id);
  redirect(`/import?ok=${ok}&errors=${errors}`);
}
