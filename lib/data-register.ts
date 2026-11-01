import type { DatabaseSync } from "node:sqlite";
import { componentAvailability, meanTimeBetweenFailures, missionReliability } from "@/lib/workspace/reliability";

/**
 * The data register is a spreadsheet-shaped projection of the PBS component
 * level, joined to the live rate and the MTTR record. It owns no table of
 * its own: every value belongs to the module that already owns it, so the
 * register can never disagree with PBS, Data Register or MTTR.
 */

export type RegisterCriticality = "Operational" | "Mission critical" | "Safety critical";
export type RegisterStatus = "Draft" | "In review" | "Validated";

export type DataRegisterRow = {
  id: string;
  tag: string;
  description: string;
  system: string;
  systemId: string | null;
  qty: number;
  lambda: number;
  mttr: number;
  category: string;
  criticality: RegisterCriticality;
  status: RegisterStatus;
  maxSeverity: number | null;
  failureModes: number;
};

export type DataRegisterParent = {
  id: string;
  name: string;
  level: string;
  label: string;
};

export type RegisterMetrics = {
  mtbf: number;
  availability: number;
  fit: number;
  reliability: number;
};

const LEVEL_LABEL: Record<string, string> = {
  system: "System",
  subsystem: "Subsystem",
  assembly: "Assembly",
  component: "Component",
};

function criticalityOf(maxSeverity: number | null, failureModes: number): RegisterCriticality {
  if (maxSeverity != null && maxSeverity >= 9) return "Safety critical";
  if (failureModes > 0 || (maxSeverity != null && maxSeverity >= 5)) return "Mission critical";
  return "Operational";
}

function statusOf(lambda: number, mttr: number): RegisterStatus {
  if (lambda > 0 && mttr > 0) return "Validated";
  if (lambda > 0 || mttr > 0) return "In review";
  return "Draft";
}

export function registerMetrics(row: Pick<DataRegisterRow, "lambda" | "mttr">, missionHours: number): RegisterMetrics {
  const lambda = Number(row.lambda) || 0;
  const mttr = Number(row.mttr) || 0;
  return {
    mtbf: meanTimeBetweenFailures(lambda),
    availability: componentAvailability({ lambda, mttr }),
    fit: Math.max(0, lambda) * 1e9,
    reliability: missionReliability(lambda, missionHours),
  };
}

/** Component lines ordered by parent, matching the PBS reading order. */
export function dataRegisterRows(db: DatabaseSync, projectId: string): DataRegisterRow[] {
  const rows = db
    .prepare(
      `SELECT n.id, n.name, n.part_number, n.quantity, n.category,
              n.parent_id,
              p.name AS parent_name,
              f.lambda_per_hour,
              m.mttr_hours,
              (SELECT MAX(r.severity) FROM fmea_rows r WHERE r.pbs_node_id = n.id) AS max_severity,
              (SELECT COUNT(*) FROM fmea_rows r WHERE r.pbs_node_id = n.id) AS failure_modes
         FROM pbs_nodes n
         LEFT JOIN pbs_nodes p ON p.id = n.parent_id
         LEFT JOIN failure_rates f ON f.pbs_node_id = n.id
         LEFT JOIN mttr_records m ON m.pbs_node_id = n.id
        WHERE n.project_id = ? AND n.level = 'component'
        ORDER BY COALESCE(p.name, ''), n.sort_order, n.name`,
    )
    .all(projectId) as any[];

  return rows.map((row) => {
    const lambda = Number(row.lambda_per_hour) || 0;
    const mttr = row.mttr_hours == null ? 0 : Number(row.mttr_hours) || 0;
    const maxSeverity = row.max_severity == null ? null : Number(row.max_severity);
    const failureModes = Number(row.failure_modes) || 0;
    return {
      id: row.id as string,
      tag: (row.part_number as string | null) || (row.name as string),
      description: row.name as string,
      system: (row.parent_name as string | null) || "Unassigned",
      systemId: (row.parent_id as string | null) ?? null,
      qty: Number(row.quantity) || 1,
      lambda,
      mttr,
      category: (row.category as string | null) || "other",
      criticality: criticalityOf(maxSeverity, failureModes),
      status: statusOf(lambda, mttr),
      maxSeverity,
      failureModes,
    };
  });
}

/** Non-component nodes, used as the "System" picker on each register line. */
export function dataRegisterParents(db: DatabaseSync, projectId: string): DataRegisterParent[] {
  const rows = db
    .prepare(
      `SELECT id, name, level FROM pbs_nodes
        WHERE project_id = ? AND level <> 'component'
        ORDER BY depth, sort_order, name`,
    )
    .all(projectId) as any[];
  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    level: row.level as string,
    label: `${LEVEL_LABEL[row.level] ?? row.level} · ${row.name}`,
  }));
}

/**
 * CSV aliases carried over from the RAMSport data register, extended with the
 * RAMS360 column names so an existing register file imports unchanged.
 */
export const REGISTER_ALIASES: Record<string, string> = {
  id: "id",
  componentid: "tag",
  assetid: "tag",
  lruid: "tag",
  partnumber: "tag",
  tag: "tag",
  description: "description",
  component: "description",
  name: "description",
  system: "system",
  subsystem: "system",
  parent: "system",
  quantity: "qty",
  qty: "qty",
  lambda: "lambda",
  failurerate: "lambda",
  failurerateh: "lambda",
  failurerateperh: "lambda",
  failurerateperhour: "lambda",
  failurerateper10h: "lambda",
  mttr: "mttr",
  meanrepairtime: "mttr",
  mission: "mission",
  missiontime: "mission",
  operatingtime: "mission",
  operatingtimeh: "mission",
  operatingtimehours: "mission",
  criticality: "criticality",
  status: "status",
};
