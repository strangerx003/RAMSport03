"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteDataRegisterRowAction, saveDataRegisterAction } from "@/lib/actions";
import { fmtInt } from "@/lib/format";
import {
  REGISTER_ALIASES,
  registerMetrics,
  type DataRegisterParent,
  type DataRegisterRow,
} from "@/lib/data-register";

type Notice = { kind: "success" | "error"; text: string } | null;

const NUMERIC = new Set(["qty", "lambda", "mttr"]);
const CSV_COLUMNS: { key: string; label: string }[] = [
  { key: "tag", label: "Component ID" },
  { key: "description", label: "Description" },
  { key: "system", label: "System" },
  { key: "qty", label: "Quantity" },
  { key: "lambda", label: "Failure rate (per h)" },
  { key: "mtbf", label: "MTBF (h)" },
  { key: "mttr", label: "MTTR (h)" },
  { key: "availability", label: "Availability" },
  { key: "fit", label: "FIT" },
  { key: "mission", label: "Operating time (h)" },
  { key: "criticality", label: "Criticality" },
  { key: "status", label: "Status" },
];

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else value += character;
  }
  values.push(value.trim());
  return values;
}

function escapeCsv(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function isNew(row: DataRegisterRow) {
  return row.id.startsWith("new-");
}

export default function DataRegister({
  projectId,
  rows: initialRows,
  parents,
  missionHours,
  canWrite,
}: {
  projectId: string;
  rows: DataRegisterRow[];
  parents: DataRegisterParent[];
  missionHours: number;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<DataRegisterRow[]>(initialRows);
  const [selected, setSelected] = useState<string>("");
  const [query, setQuery] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [savedAt, setSavedAt] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRows(initialRows);
    setDirty(false);
  }, [initialRows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      `${row.tag} ${row.description} ${row.system} ${row.criticality} ${row.status}`.toLowerCase().includes(needle),
    );
  }, [rows, query]);

  const parentById = useMemo(() => new Map(parents.map((parent) => [parent.id, parent])), [parents]);

  function update(id: string, patch: Partial<DataRegisterRow>) {
    if (!canWrite) return;
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setDirty(true);
  }

  function systemName(systemId: string | null) {
    return (systemId ? parentById.get(systemId)?.name : null) || "Unassigned";
  }

  function addRow() {
    if (!canWrite) return;
    const suffix = rows.length + 1;
    const systemId = parents[0]?.id ?? null;
    const row: DataRegisterRow = {
      id: `new-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
      tag: `NEW-${String(suffix).padStart(3, "0")}`,
      description: "New component",
      system: systemName(systemId),
      systemId,
      qty: 1,
      lambda: 0,
      mttr: 0,
      category: "other",
      criticality: "Operational",
      status: "Draft",
      maxSeverity: null,
      failureModes: 0,
    };
    setRows((current) => [...current, row]);
    setSelected(row.id);
    setQuery("");
    setDirty(true);
  }

  async function removeRow(id: string) {
    if (!canWrite) return;
    if (id.startsWith("new-")) {
      setRows((current) => current.filter((row) => row.id !== id));
      setSelected("");
      setDirty(true);
      return;
    }
    const row = rows.find((item) => item.id === id);
    if (!row) return;
    if (!window.confirm(`Delete ${row.description}? Its failure modes, MTTR steps and maintenance links are removed with it.`)) {
      return;
    }
    try {
      await deleteDataRegisterRowAction({ projectId, id });
      setRows((current) => current.filter((item) => item.id !== id));
      setSelected("");
      setNotice({ kind: "success", text: `${row.description} deleted from the register.` });
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "The row could not be deleted." });
    }
  }

  async function save() {
    if (!canWrite) return;
    if (rows.some((row) => !row.description.trim())) {
      setNotice({ kind: "error", text: "Every row needs a description before it can be saved." });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const result = await saveDataRegisterAction({
        projectId,
        rows: rows.map((row) => ({
          id: row.id,
          tag: row.tag,
          description: row.description,
          systemId: row.systemId,
          qty: row.qty,
          lambda: row.lambda,
          mttr: row.mttr,
        })),
      });
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      setNotice({
        kind: "success",
        text: `Register saved — ${result.created} created, ${result.updated} updated.`,
      });
      router.refresh();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "The register could not be saved." });
    } finally {
      setSaving(false);
    }
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !canWrite) return;
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") {
      setNotice({ kind: "error", text: "Import cancelled: choose a CSV file." });
      return;
    }
    try {
      const lines = (await file.text()).replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) {
        setNotice({ kind: "error", text: "CSV import requires a header row and at least one component record." });
        return;
      }
      const header = parseCsvLine(lines[0]).map((name) => REGISTER_ALIASES[name.toLowerCase().replace(/[^a-z0-9]/g, "")]);
      if (!header.some((key) => key === "tag" || key === "description")) {
        setNotice({ kind: "error", text: "CSV import requires a Component ID or Description column." });
        return;
      }
      const imported = lines.slice(1).map((line) => {
        const values = parseCsvLine(line);
        const record: Record<string, string | number> = {};
        header.forEach((key, index) => {
          if (!key || values[index] === undefined) return;
          record[key] = NUMERIC.has(key) ? Number(values[index]) : values[index];
        });
        return record;
      }).filter((record) => record.tag || record.description);
      if (!imported.length) {
        setNotice({ kind: "error", text: "No component records were found in the CSV file." });
        return;
      }
      if (imported.some((record) => ["qty", "lambda", "mttr"].some((key) => record[key] !== undefined && !Number.isFinite(Number(record[key]))))) {
        setNotice({ kind: "error", text: "CSV import cancelled: one or more numeric values are invalid." });
        return;
      }

      setRows((current) => {
        const merged = [...current];
        imported.forEach((record) => {
          const tag = String(record.tag ?? "").trim();
          const description = String(record.description ?? "").trim();
          const match = merged.findIndex(
            (row) =>
              (tag && row.tag.toLowerCase() === tag.toLowerCase()) ||
              (description && row.description.toLowerCase() === description.toLowerCase()),
          );
          const parent =
            parents.find((item) => item.name.toLowerCase() === String(record.system ?? "").toLowerCase()) ??
            (record.system ? undefined : parents[0]);
          if (match >= 0) {
            merged[match] = {
              ...merged[match],
              tag: tag || merged[match].tag,
              description: description || merged[match].description,
              systemId: parent?.id ?? merged[match].systemId,
              system: parent?.name ?? merged[match].system,
              qty: record.qty !== undefined ? Number(record.qty) : merged[match].qty,
              lambda: record.lambda !== undefined ? Number(record.lambda) : merged[match].lambda,
              mttr: record.mttr !== undefined ? Number(record.mttr) : merged[match].mttr,
            };
          } else {
            merged.push({
              id: `new-${globalThis.crypto?.randomUUID?.() ?? Date.now() + merged.length}`,
              tag: tag || `COMP-${merged.length + 1}`,
              description: description || "Imported component",
              system: parent?.name ?? "Unassigned",
              systemId: parent?.id ?? null,
              qty: Number(record.qty ?? 1) || 1,
              lambda: Number(record.lambda ?? 0) || 0,
              mttr: Number(record.mttr ?? 0) || 0,
              category: "other",
              criticality: "Operational",
              status: "Draft",
              maxSeverity: null,
              failureModes: 0,
            });
          }
        });
        return merged;
      });
      setDirty(true);
      setNotice({ kind: "success", text: `${imported.length} record${imported.length === 1 ? "" : "s"} imported and merged by Component ID. Review, then save.` });
    } catch {
      setNotice({ kind: "error", text: "The CSV file could not be read. Check its format and try again." });
    }
  }

  function exportCsv() {
    const payload = rows.map((row) => {
      const metrics = registerMetrics(row, missionHours);
      return {
        tag: row.tag,
        description: row.description,
        system: systemName(row.systemId),
        qty: row.qty,
        lambda: row.lambda,
        mtbf: row.lambda > 0 ? Math.round(metrics.mtbf) : "—",
        mttr: row.mttr,
        availability: `${(metrics.availability * 100).toFixed(5)}%`,
        fit: Math.round(metrics.fit),
        mission: missionHours,
        criticality: row.criticality,
        status: row.status,
      } as Record<string, unknown>;
    });
    const csv = [
      CSV_COLUMNS.map((column) => escapeCsv(column.label)).join(","),
      ...payload.map((row) => CSV_COLUMNS.map((column) => escapeCsv(row[column.key])).join(",")),
    ].join("\r\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `data-register-${projectId}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const missingRate = rows.filter((row) => !(row.lambda > 0)).length;
  const missingMttr = rows.filter((row) => !(row.mttr > 0)).length;

  return (
    <section className={`reg ${canWrite ? "" : "reg-readonly"}`}>
      <div className="reg-toolbar">
        <button type="button" className="btn btn-sm" onClick={addRow} disabled={!canWrite}>
          + Add row
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => selected && removeRow(selected)}
          disabled={!canWrite || !selected}
        >
          Delete row
        </button>
        <label className="reg-search">
          <span aria-hidden="true">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a component, system or status" />
        </label>
        <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={importCsv} />
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => fileInput.current?.click()} disabled={!canWrite}>
          Import CSV
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={exportCsv} disabled={!rows.length}>
          Export CSV
        </button>
        <span className={`reg-state ${dirty ? "dirty" : "clean"}`}>
          {dirty ? "Unsaved changes" : savedAt ? `Saved ${savedAt}` : "All changes saved"}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={save}
          disabled={!canWrite || !dirty || saving}
          title={canWrite ? "Write PBS and MTTR in one pass" : "Read-only access"}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      {notice ? (
        <div className={`reg-notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">
            ×
          </button>
        </div>
      ) : null}

      <div className="reg-scroll">
        <table className="reg-table">
          <thead>
            <tr>
              <th className="reg-rownum">#</th>
              <th>Component ID</th>
              <th>Description</th>
              <th>System</th>
              <th className="num">Qty</th>
              <th className="num">λ /h</th>
              <th className="num computed">MTBF (h)</th>
              <th className="num">MTTR (h)</th>
              <th className="num computed">Availability</th>
              <th className="num computed">FIT</th>
              <th className="num computed">R(t)</th>
              <th>Criticality</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, index) => {
              const metrics = registerMetrics(row, missionHours);
              const active = selected === row.id;
              return (
                <tr
                  key={row.id}
                  className={`${active ? "selected" : ""} ${isNew(row) ? "is-new" : ""}`}
                  onClick={() => setSelected(row.id)}
                >
                  <td className="reg-rownum">{index + 1}</td>
                  <td>
                    <input
                      className="reg-input mono"
                      value={row.tag}
                      disabled={!canWrite}
                      onChange={(event) => update(row.id, { tag: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="reg-input"
                      value={row.description}
                      disabled={!canWrite}
                      onChange={(event) => update(row.id, { description: event.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      className="reg-select"
                      value={row.systemId ?? ""}
                      disabled={!canWrite}
                      onChange={(event) => {
                        const systemId = event.target.value || null;
                        update(row.id, { systemId, system: systemName(systemId) });
                      }}
                    >
                      <option value="">Unassigned</option>
                      {parents.map((parent) => (
                        <option value={parent.id} key={parent.id}>
                          {parent.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="reg-input num"
                      type="number"
                      min={0}
                      step="any"
                      value={row.qty}
                      disabled={!canWrite}
                      onChange={(event) => update(row.id, { qty: Number(event.target.value) || 0 })}
                    />
                  </td>
                  <td>
                    <input
                      className="reg-input num"
                      type="number"
                      min={0}
                      step="any"
                      value={row.lambda}
                      disabled={!canWrite}
                      onChange={(event) => update(row.id, { lambda: Number(event.target.value) || 0 })}
                    />
                  </td>
                  <td className="num computed">{row.lambda > 0 ? fmtInt(metrics.mtbf) : "∞"}</td>
                  <td>
                    <input
                      className="reg-input num"
                      type="number"
                      min={0}
                      step="any"
                      value={row.mttr}
                      disabled={!canWrite}
                      onChange={(event) => update(row.id, { mttr: Number(event.target.value) || 0 })}
                    />
                  </td>
                  <td className="num computed">{(metrics.availability * 100).toFixed(5)}%</td>
                  <td className="num computed">{fmtInt(metrics.fit)}</td>
                  <td className="num computed">{(metrics.reliability * 100).toFixed(5)}%</td>
                  <td>
                    <span className={`reg-badge ${row.criticality === "Safety critical" ? "danger" : row.criticality === "Mission critical" ? "warn" : "neutral"}`} title={row.maxSeverity != null ? `Highest FMEA severity ${row.maxSeverity}` : "No failure modes yet"}>
                      {row.criticality}
                    </span>
                  </td>
                  <td>
                    <span className={`reg-badge ${row.status === "Validated" ? "ok" : row.status === "In review" ? "info" : "neutral"}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="reg-actions">
                    <button
                      type="button"
                      className="reg-delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeRow(row.id);
                      }}
                      disabled={!canWrite}
                      title="Delete component line"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
            {!filtered.length ? (
              <tr>
                <td className="reg-empty" colSpan={14}>
                  {rows.length
                    ? `No component matches “${query}”. Clear the search to see all ${rows.length} lines.`
                    : "No component lines yet. Add a row, import a CSV, or add components in PBS."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <footer className="reg-foot">
        <span>
          {filtered.length} of {rows.length} component lines
        </span>
        <span>{missingRate} missing λ</span>
        <span>{missingMttr} missing MTTR</span>
        <span className="reg-foot-note">Edits write PBS and MTTR together on save.</span>
      </footer>
    </section>
  );
}
