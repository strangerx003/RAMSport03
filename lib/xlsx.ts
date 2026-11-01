import * as XLSX from "xlsx";
import type { Snapshot } from "@/lib/snapshot";

type Cell = string | number | null | undefined;

function sheet(rows: Cell[][]) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const widths = new Map<number, number>();
  for (const row of rows) {
    row.forEach((value, index) => {
      const length = value == null ? 0 : String(value).length;
      widths.set(index, Math.min(48, Math.max(widths.get(index) ?? 8, length + 2)));
    });
  }
  worksheet["!cols"] = [...widths.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, width]) => ({ wch: width }));
  return worksheet;
}

function perMillion(lambda: number | null | undefined) {
  if (lambda == null || !Number.isFinite(lambda)) return null;
  return Number((lambda * 1e6).toFixed(9));
}

function round(value: number | null | undefined, digits = 6) {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function controlsText(raw: string | null | undefined) {
  try {
    const list = JSON.parse(raw || "[]") as any[];
    return list
      .map((control) => `${control.level ? `${control.level}: ` : ""}${control.control ?? ""}`.trim())
      .filter(Boolean)
      .join(" | ");
  } catch {
    return "";
  }
}

export function buildReportWorkbook(snapshot: Snapshot): Buffer {
  const project = snapshot.project;
  const modules = new Set(snapshot.modules);
  const workbook = XLSX.utils.book_new();

  const cover: Cell[][] = [
    ["RAMSport03 report pack"],
    [],
    ["Project", project.name],
    ["Project code", project.code ?? ""],
    ["Customer", project.customer ?? ""],
    ["Revision", snapshot.rev],
    ["Snapshot taken", snapshot.generated_at],
    ["Modules", snapshot.modules.join(", ")],
    ["Mission hours", project.mission_hours],
    ["Operating hours / year", project.operating_hours],
    ["Product life (years)", project.product_life_years],
    [],
    ["This workbook was rebuilt from a frozen snapshot. Values do not change when the live analysis moves on."],
  ];
  XLSX.utils.book_append_sheet(workbook, sheet(cover), "Cover");

  if (modules.has("pbs")) {
    const byId = new Map<string, any>(snapshot.pbs.map((node) => [node.id, node]));
    const pathOf = (node: any): string => {
      const parts: string[] = [];
      let current = node;
      let guard = 0;
      while (current && guard < 40) {
        parts.unshift(current.name);
        current = current.parent_id ? byId.get(current.parent_id) : null;
        guard++;
      }
      return parts.join(" / ");
    };
    const rows: Cell[][] = [
      ["Level", "Name", "Path", "Parent", "Part number", "Quantity", "Category", "Location", "Depth", "Sort"],
      ...snapshot.pbs.map((node) => [
        node.level,
        node.name,
        pathOf(node),
        node.parent_name ?? "",
        node.part_number ?? "",
        node.quantity,
        node.category,
        node.location ?? "",
        node.depth,
        node.sort_order,
      ]),
    ];
    XLSX.utils.book_append_sheet(workbook, sheet(rows), "PBS");
  }

  if (modules.has("pm")) {
    const rows: Cell[][] = [
      ["Component", "Task", "Strategy", "Interval", "Unit", "Manpower", "Last done", "Next due"],
      ...snapshot.pm.map((task) => [
        task.node_name,
        task.description,
        task.strategy,
        task.interval_value,
        task.interval_unit,
        task.manpower,
        task.last_done_at ?? "",
        task.next_due_at ?? "",
      ]),
    ];
    XLSX.utils.book_append_sheet(workbook, sheet(rows), "PM");
  }

  if (modules.has("spares")) {
    const rows: Cell[][] = [
      ["Component", "Part number", "Lambda FPMH", "Quantity", "On hand", "Lead days", "MOQ", "Service level", "Reorder point", "Safety stock", "Recommended qty", "Gap", "Unit cost", "Inventory value"],
      ...snapshot.spares.map((item) => [
        item.node_name,
        item.part_number ?? "",
        perMillion(item.lambda),
        item.node_quantity,
        item.qty_on_hand,
        item.lead_time_days,
        item.moq,
        item.service_level,
        item.reorder_point,
        item.safety_stock,
        item.recommended_qty,
        item.recommended_qty != null ? item.recommended_qty - item.qty_on_hand : null,
        item.unit_cost_cents != null ? item.unit_cost_cents / 100 : null,
        item.unit_cost_cents != null ? (item.qty_on_hand * item.unit_cost_cents) / 100 : null,
      ]),
    ];
    XLSX.utils.book_append_sheet(workbook, sheet(rows), "Spares");
  }

  if (modules.has("safety")) {
    const rows: Cell[][] = [
      ["Hazard", "Component", "Severity", "Likelihood", "Initial risk", "Residual severity", "Residual likelihood", "Residual risk", "ALARP", "Controls"],
      ...snapshot.hazards.map((hazard) => {
        const residualS = hazard.residual_severity ?? hazard.severity;
        const residualL = hazard.residual_likelihood ?? hazard.likelihood;
        return [
          hazard.description,
          hazard.node_name ?? "",
          hazard.severity,
          hazard.likelihood,
          hazard.severity * hazard.likelihood,
          residualS,
          residualL,
          residualS * residualL,
          hazard.alarp,
          controlsText(hazard.controls),
        ];
      }),
    ];
    XLSX.utils.book_append_sheet(workbook, sheet(rows), "Safety");
  }

  if (modules.has("fta") && snapshot.fta) {
    const rows: Cell[][] = [
      ["Tree", snapshot.fta.name, "Top event", snapshot.fta.top_label ?? "", "Q(t)", snapshot.fta.q_t ?? "", "Mission hours", snapshot.fta.mission_hours],
      [],
      ["Label", "Type", "Gate", "k", "Component", "Fixed probability", "Order"],
      ...snapshot.fta.nodes.map((node: any) => [
        node.label,
        node.node_type,
        node.gate_type ?? "",
        node.gate_k ?? "",
        node.pbs_node_id ?? "",
        node.probability ?? "",
        node.sort_order,
      ]),
    ];
    XLSX.utils.book_append_sheet(workbook, sheet(rows), "FTA");
  }

  if (modules.has("rbd") && snapshot.rbd) {
    const rows: Cell[][] = [
      ["Model", snapshot.rbd.name, "Rsys", snapshot.rbd.rsys ?? "", "Availability", snapshot.rbd.availability ?? "", "Mission hours", snapshot.rbd.mission_hours ?? ""],
      [],
      ["Block", "Component", "Reliability", "Stage key", "Stage type", "k", "n", "Order"],
      ...snapshot.rbd.blocks.map((block: any) => [
        block.label,
        block.pbs_node_id ?? "",
        block.reliability,
        block.group_key,
        block.group_type,
        block.group_k ?? "",
        block.group_n ?? "",
        block.sort_order,
      ]),
    ];
    XLSX.utils.book_append_sheet(workbook, sheet(rows), "RBD");
  }

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function buildSparesWorkbook(
  project: any,
  rows: any[],
): Buffer {
  const workbook = XLSX.utils.book_new();
  const cover: Cell[][] = [
    ["Spares plan"],
    [],
    ["Project", project.name],
    ["Revision", project.rev],
    ["Operating hours / year", project.operating_hours],
    ["Exported", new Date().toISOString()],
    [],
    ["Demand: lambda x operating hours x quantity. Reorder point and recommended qty come from the spares model."],
  ];
  XLSX.utils.book_append_sheet(workbook, sheet(cover), "Cover");

  const detail: Cell[][] = [
    [
      "Component",
      "Part number",
      "Lambda FPMH",
      "Quantity",
      "On hand",
      "Lead days",
      "MOQ",
      "Service level",
      "Annual demand",
      "Lead-time demand",
      "Safety stock",
      "Reorder point",
      "Recommended qty",
      "Gap",
      "Unit cost",
      "Inventory value",
      "Below reorder",
    ],
    ...rows.map((row) => [
      row.node_name,
      row.part_number ?? "",
      perMillion(row.lambda),
      row.node_quantity,
      row.qty_on_hand,
      row.lead_time_days,
      row.moq,
      row.service_level,
      round(row.model?.annualDemand, 4),
      round(
        row.model?.annualDemand != null
          ? (row.model.annualDemand * (row.lead_time_days || 0)) / 365
          : null,
        4,
      ),
      row.safety_stock ?? row.model?.safetyStock ?? null,
      row.reorder_point ?? row.model?.reorderPoint ?? null,
      row.recommended_qty ?? row.model?.recommendedQty ?? null,
      round(row.gap, 2),
      row.unit_cost_cents != null ? row.unit_cost_cents / 100 : null,
      row.unit_cost_cents != null ? (row.qty_on_hand * row.unit_cost_cents) / 100 : null,
      row.below_reorder ? "yes" : "no",
    ]),
  ];
  XLSX.utils.book_append_sheet(workbook, sheet(detail), "Spares");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function buildImportTemplate(): Buffer {
  const workbook = XLSX.utils.book_new();
  const instructions: Cell[][] = [
    ["RAMSport03 hierarchy import template"],
    [],
    ["How to use"],
    ["1. Keep the header row exactly as shown on the 'Hierarchy' sheet."],
    ["2. Parents must appear before their children; Parent is the full path, e.g. 'Kestrel-9 / Flight Control'."],
    ["3. Level is one of system, subsystem, assembly, component. Leave blank to infer from the parent."],
    ["4. Lambda is FPMH: failures per million hours. Leave blank when the component has no predicted rate yet."],
    ["5. Import adds rows; it does not overwrite the existing hierarchy."],
    [],
    ["Limits"],
    ["File size 10 MB. First worksheet only. Rows without a Name are skipped."],
  ];
  XLSX.utils.book_append_sheet(workbook, sheet(instructions), "Instructions");

  const hierarchy: Cell[][] = [
    ["Name", "Parent", "Level", "Part Number", "Quantity", "Category", "Lambda"],
    ["Kestrel-9 Flight Control", "", "system", "K9-FCS", 1, "other", ""],
    ["Flight Control Computer", "Kestrel-9 Flight Control", "subsystem", "K9-FCC", 1, "electronic", ""],
    ["Main Processor", "Kestrel-9 Flight Control / Flight Control Computer", "component", "MCU-7420", 1, "electronic", 8],
    ["Sensor Interface", "Kestrel-9 Flight Control / Flight Control Computer", "component", "IMU-3110", 2, "electronic", 6.5],
    ["Actuation", "Kestrel-9 Flight Control", "subsystem", "K9-ACT", 1, "mechanical", ""],
    ["Aileron Servo", "Kestrel-9 Flight Control / Actuation", "component", "SRV-88", 2, "mechanical", 4.2],
  ];
  XLSX.utils.book_append_sheet(workbook, sheet(hierarchy), "Hierarchy");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
