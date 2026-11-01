import Link from "next/link";
import {
  addPbsNodeAction,
  deletePbsNodeAction,
  updatePbsNodeAction,
} from "@/lib/actions";
import { NODE_CATEGORIES, NODE_LEVELS, LEVEL_LABEL, nextLevel } from "@/lib/constants";
import { pbsRows } from "@/lib/repo";
import { requireActiveProject } from "@/lib/session";
import { Badge, Card, Empty, Field, Notice, PageHead } from "@/components/ui";
import { ConfirmForm } from "@/components/ConfirmForm";
import { fmt, fmtInt, fmtLambda, hours } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "PBS" };

type Row = any;

function buildTree(rows: Row[]) {
  const byParent = new Map<string | null, Row[]>();
  for (const row of rows) {
    const key = row.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(row);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  return byParent;
}

function flatten(byParent: Map<string | null, Row[]>, parent: string | null, depth: number, out: (Row & { uiDepth: number })[]) {
  for (const row of byParent.get(parent) ?? []) {
    out.push({ ...row, uiDepth: depth });
    flatten(byParent, row.id, depth + 1, out);
  }
  return out;
}

export default async function PbsPage({
  searchParams,
}: {
  searchParams: Promise<{ node?: string; ok?: string }>;
}) {
  const { node: selectedId, ok } = await searchParams;
  const ctx = await requireActiveProject();
  const projectId = ctx.project.id;
  ctx.requireRead("pbs");
  const grants = ctx.access("pbs");

  const rows = pbsRows(ctx.db, projectId);
  const byParent = buildTree(rows);
  const ordered = flatten(byParent, null, 0, []);

  const rates = new Map(
    (ctx.db.prepare("SELECT pbs_node_id, lambda_per_hour FROM failure_rates WHERE project_id = ?").all(projectId) as any[]).map(
      (r) => [r.pbs_node_id, r.lambda_per_hour as number],
    ),
  );
  const mttrs = new Map(
    (ctx.db.prepare("SELECT pbs_node_id, mttr_hours FROM mttr_records WHERE project_id = ?").all(projectId) as any[]).map(
      (r) => [r.pbs_node_id, r.mttr_hours as number | null],
    ),
  );

  const subtree = new Map<string, { lambda: number; components: number }>();
  const compute = (id: string): { lambda: number; components: number } => {
    const row = rows.find((r) => r.id === id)!;
    // Per-unit rate x line quantity, matching the Data Register and project totals.
    const own = row.level === "component" ? (rates.get(id) ?? 0) * (row.quantity || 1) : 0;
    let lambda = own;
    let components = row.level === "component" ? 1 : 0;
    for (const child of byParent.get(id) ?? []) {
      const value = compute(child.id);
      lambda += value.lambda;
      components += value.components;
    }
    const value = { lambda, components };
    subtree.set(id, value);
    return value;
  };
  for (const root of byParent.get(null) ?? []) compute(root.id);

  const selected = ordered.find((row) => row.id === selectedId) ?? ordered[0] ?? null;
  const totalLambda = (byParent.get(null) ?? []).reduce((sum, r) => sum + (subtree.get(r.id)?.lambda ?? 0), 0);
  const totalComponents = (byParent.get(null) ?? []).reduce((sum, r) => sum + (subtree.get(r.id)?.components ?? 0), 0);
  const missingRates = rows.filter((row) => row.level === "component" && !rates.has(row.id)).length;

  const blockedParents = new Set<string>();
  if (selected) {
    const walk = (id: string) => {
      blockedParents.add(id);
      for (const child of byParent.get(id) ?? []) walk(child.id);
    };
    walk(selected.id);
  }
  const parentOptions = ordered.filter((row) => !blockedParents.has(row.id));

  const levelCounts = NODE_LEVELS.map((level) => ({
    level,
    count: rows.filter((row) => row.level === level).length,
  }));

  return (
    <>
      <PageHead
        eyebrow="01 · Product Breakdown Structure"
        title="PBS"
        desc="The single hierarchy every other module reads from. Adding, moving or deleting a node here re-prices FMECA, FTA, RBD and spares on the next save."
        formula="λ(subtree) = λ(unit) × qty + Σ λ(children)   ·   components only"
      >
        <Link className="btn" href={`/import`}>
          Import hierarchy
        </Link>
      </PageHead>

      {ok === "created" ? <div className="toast">Project created. Every module below reads from this breakdown.</div> : null}


      {missingRates ? (
        <div style={{ marginTop: 14 }}>
          <Notice tone="warn">
            {missingRates} component{missingRates === 1 ? "" : "s"} have no failure rate. Downstream modules
            treat them as zero until a λ is set in <Link href={`/data-register`}>Data Register</Link>.
          </Notice>
        </div>
      ) : null}

      <div className="split" style={{ marginTop: 16 }}>
        <Card title="Hierarchy" sub={`${ordered.length} nodes · click a row to edit it`} body="tight">
          {ordered.length === 0 ? (
            <Empty title="No PBS yet">
              Add a system node on the right to start the hierarchy.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Node</th>
                    <th>Level</th>
                    <th>Part number</th>
                    <th className="num">Qty</th>
                    <th className="num">λ subtree (FPMH)</th>
                    <th className="num">Components</th>
                    <th className="num">MTTR</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((row) => {
                    const value = subtree.get(row.id);
                    const active = selected?.id === row.id;
                    return (
                      <tr key={row.id} className={active ? "selected" : undefined}>
                        <td>
                          <Link href={`/pbs?node=${row.id}`} className="tree-name" style={{ color: "inherit" }}>
                            <span className="tree-indent">{"· ".repeat(Math.max(0, row.uiDepth))}</span>
                            <span style={{ fontWeight: row.level === "component" ? 400 : 600 }}>{row.name}</span>
                            {row.level === "component" && !rates.has(row.id) ? <Badge tone="warn">no λ</Badge> : null}
                          </Link>
                        </td>
                        <td>
                          <span className="chip">{LEVEL_LABEL[row.level]}</span>
                        </td>
                        <td className="mono small">{row.part_number ?? "—"}</td>
                        <td className="num">{fmt(row.quantity, 0)}</td>
                        <td className="num">{fmtLambda(value?.lambda ?? 0)}</td>
                        <td className="num">{fmtInt(value?.components ?? 0)}</td>
                        <td className="num">{mttrs.get(row.id) != null ? `${fmt(mttrs.get(row.id), 2)} h` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="stack">
          {selected ? (
            <Card
              title={selected.name}
              sub={`${LEVEL_LABEL[selected.level]} · ${subtree.get(selected.id)?.components ?? 0} component lines · λ ${fmtLambda(subtree.get(selected.id)?.lambda ?? 0)} FPMH`}
            >
              {grants.write ? (
                <form action={updatePbsNodeAction}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="id" value={selected.id} />
                  <div className="form-grid">
                    <Field label="Name" span>
                      <input className="input" name="name" defaultValue={selected.name} required />
                    </Field>
                    <Field label="Part number">
                      <input className="input" name="partNumber" defaultValue={selected.part_number ?? ""} />
                    </Field>
                    <Field label="Quantity">
                      <input className="input num" type="number" step="1" min="0" name="quantity" defaultValue={selected.quantity} />
                    </Field>
                    <Field label="Category">
                      <select className="select" name="category" defaultValue={selected.category}>
                        {NODE_CATEGORIES.map((category) => (
                          <option value={category} key={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Location">
                      <input className="input" name="location" defaultValue={selected.location ?? ""} />
                    </Field>
                    <Field label="Parent" span hint="Moving a node under one of its own descendants is rejected.">
                      <select className="select" name="parentId" defaultValue={selected.parent_id ?? ""}>
                        <option value="">(top level)</option>
                        {parentOptions.map((row) => (
                          <option value={row.id} key={row.id}>
                            {"— ".repeat(row.uiDepth)}
                            {row.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Sort order">
                      <input className="input num" type="number" step="1" name="sortOrder" defaultValue={selected.sort_order} />
                    </Field>
                  </div>
                  <div className="row end" style={{ marginTop: 12 }}>
                    <button className="btn btn-primary btn-sm" type="submit">
                      Save node
                    </button>
                  </div>
                </form>
              ) : (
                <dl className="kv">
                  <dt>Part number</dt>
                  <dd>{selected.part_number ?? "—"}</dd>
                  <dt>Quantity</dt>
                  <dd>{fmt(selected.quantity, 0)}</dd>
                  <dt>Category</dt>
                  <dd>{selected.category}</dd>
                  <dt>Location</dt>
                  <dd>{selected.location ?? "—"}</dd>
                  <dt>MTTR</dt>
                  <dd>{mttrs.get(selected.id) != null ? hours(mttrs.get(selected.id)) : "—"}</dd>
                </dl>
              )}

              {grants.write ? (
                <ConfirmForm
                  action={deletePbsNodeAction}
                  confirm={`Delete ${selected.name} and its entire subtree? Failure modes, MTTR, spares and tree nodes referencing it will be removed.`}
                  style={{ marginTop: 12 }}
                >
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="id" value={selected.id} />
                  <button className="btn btn-sm btn-danger" type="submit">
                    Delete node and subtree
                  </button>
                </ConfirmForm>
              ) : null}
            </Card>
          ) : null}

          {grants.write ? (
            <Card
              title={selected ? "Add a child" : "Add the first node"}
              sub={selected ? `Will be created under ${selected.name}` : "Start with a system node"}
            >
              <form action={addPbsNodeAction}>
                <input type="hidden" name="projectId" value={projectId} />
                {selected ? <input type="hidden" name="parentId" value={selected.id} /> : null}
                <div className="form-grid">
                  <Field label="Name" span>
                    <input className="input" name="name" placeholder="e.g. Aileron Actuator" required />
                  </Field>
                  <Field label="Level">
                    <select className="select" name="level" defaultValue={selected ? nextLevel(selected.level) : "system"}>
                      {NODE_LEVELS.map((level) => (
                        <option value={level} key={level}>
                          {LEVEL_LABEL[level]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Category">
                    <select className="select" name="category" defaultValue="other">
                      {NODE_CATEGORIES.map((category) => (
                        <option value={category} key={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Part number">
                    <input className="input" name="partNumber" />
                  </Field>
                  <Field label="Quantity">
                    <input className="input num" type="number" step="1" min="0" name="quantity" defaultValue={1} />
                  </Field>
                  <Field label="Location" span>
                    <input className="input" name="location" />
                  </Field>
                </div>
                <div className="row end" style={{ marginTop: 12 }}>
                  <button className="btn btn-sm" type="submit">
                    Add node
                  </button>
                </div>
              </form>
            </Card>
          ) : (
            <Card title="Read-only access">
              <p className="small muted">
                You can browse this hierarchy but not change it. Ask a company admin for write access
                to PBS.
              </p>
            </Card>
          )}

          <Card title="Level census">
            <dl className="kv">
              {levelCounts.map((entry) => (
                <div key={entry.level} style={{ display: "contents" }}>
                  <dt>{LEVEL_LABEL[entry.level]}</dt>
                  <dd>{fmtInt(entry.count)}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}