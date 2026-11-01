import Link from "next/link";
import { redirect } from "next/navigation";
import { importSpreadsheetAction } from "@/lib/actions";
import { requireActiveProject } from "@/lib/session";
import { Badge, Card, Empty, Field, Kpi, Notice, PageHead } from "@/components/ui";
import { componentRows, pbsRows } from "@/lib/repo";
import { fmtInt, relative } from "@/lib/format";
import { HANDBOOK_NOTE } from "@/lib/copy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import" };

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; errors?: string }>; // optional status flags
}) {
  const { ok, errors } = await searchParams;

  const ctx = await requireActiveProject();
  const projectId = ctx.project.id;
  ctx.requireRead("pbs");
  const grants = ctx.access("pbs");

  const rows = pbsRows(ctx.db, projectId);
  const ordered = flatten(buildTree(rows), null, 0);
  const byId = new Map<string, any>(ordered.map(row => [row.id, row]));
  for (const row of ordered) {
    const parts: string[] = [];
    let cur = row;
    let guard = 0;
    while (cur && guard < 40) {
      parts.unshift(cur.name);
      cur = cur.parent_id ? byId.get(cur.parent_id) : null;
      guard++;
    }
    row.parentPath = parts.slice(0, -1).join(" / ");
    row.path = parts.join(" / ");
  }

  const jobs = ctx.db
    .prepare("SELECT * FROM import_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 20")
    .all(projectId) as any[];
  const aomponents = componentRows(ctx.db, projectId);
  const withRate = aomponents.filter(a => a.lambda_per_hour != null).length;
  const lastJob = jobs[0];

  return (
    <>
      <PageHead
        eyebrow="Data in"
        title="Import a hierarchy"
        desc="Bring an existing breakdown structure and its failure rates in from Excel or CSV. Rows are added in order, so parents must appear before their children."
        formula="Name · Parent · Level · Part Number · Quantity · Category · Lambda"
      >
        <a className="btn" href="/api/import/template">
          Download template
        </a>
        <Link className="btn" href={`/pbs`}>
          Open PBS
        </Link>
      </PageHead>

      {(ok || errors) && (
        <div style={{ marginBottom: 14 }}>
          <Notice tone={Number(errors) > 0 ? "warn" : "ok"}>
            <strong>{fmtInt(Number(ok) || 0)} rows imported.</strong>{" "}
            {Number(errors) > 0
              ? `${fmtInt(Number(errors) || 0)} rows were skipped – open the job below for details.`
              : "The PBS and failure rates are up to date."}
          </Notice>
        </div>
      )}

      <div className="grid cols-4">
        <Kpi label="PBS nodes" value={fmtInt(rows.length)} foot={`${fmtInt(aomponents.length)} component lines`} />
        <Kpi
          label="Components with λ"
          value={`${fmtInt(withRate)} / ${fmtInt(aomponents.length)}`}
          tone={withRate < aomponents.length ? "warn" : "ok"}
          foot="A Lambda column fills this in on import"
        />
        <Kpi label="Import jobs" value={fmtInt(jobs.length)} foot={lastJob ? `Last ${relative(lastJob.created_at)}` : "No imports yet"} />
        <Kpi
          label="Last result"
          value={lastJob ? `${fmtInt(lastJob.rows_ok)} / ${fmtInt(lastJob.rows_total)}` : "—"}
          foot={lastJob ? lastJob.status : "—"}
          tone={lastJob && lastJob.rows_error > 0 ? "warn" : undefined}
        />
      </div>

      <div className="split" style={{ marginTop: 16 }}>
        <Card title="Upload" sub="One worksheet, header row required, 10 MB limit">
          {grants.write ? (
            <form action={importSpreadsheetAction}>
              <input type="hidden" name="projectId" value={projectId} />
              <Field label="Workbook or CSV" hint="The first worksheet is read. .xlsx and .csv are accepted.">
                <input className="input" type="file" name="file" accept=".xlsx,.xls,.csv" required />
              </Field>
              <div className="alert alert-info" style={{ marginTop: 12 }}>
                <strong>This import appends.</strong> It never deletes or renames existing nodes. If the same component already exists, you will get a second copy – clean the PBS first.
              </div>
              <div className="row end" style={{ marginTop: 12 }}>
                <button className="btn btn-primary" type="submit">
                  Import rows
                </button>
              </div>
            </form>
          ) : (
            <p className="small muted">
              You have read‑only access to PBS, so you cannot import. Ask a company admin for write access.
            </p>
          )}
          <div className="hr" />
          <div className="label">Columns the importer reads</div>
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>Name</dt>
            <dd>Required. Rows without a name are skipped.</dd>
            <dt>Parent</dt>
            <dd>Full path of the parent, e.g. <span className="mono">System / Subsystem</span>.</dd>
            <dt>Level</dt>
            <dd>system, subsystem, assembly or component. Blank infers from the parent.</dd>
            <dt>Part Number</dt>
            <dd>Free text, carried to Register and FMECA.</dd>
            <dt>Quantity</dt>
            <dd>Defaults to 1 and multiplies the series λ.</dd>
            <dt>Category</dt>
            <dd>electronic, mechanical, software or other.</dd>
            <dt>Lambda</dt>
            <dd>Failure rate in FPMH (failures per million hours). Stored as an “imported” failure rate.</dd>
          </dl>
        </Card>

        <div className="stack">
          <Card title="Parent paths in this project" sub="Copy these exactly into the Parent column">
            {ordered.length === 0 ? (
              <Empty title="No nodes yet">Import a root first, then its children.</Empty>
            ) : (
              <div style={{ maxHeight: 280, overflow: "auto" }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Path</th>
                      <th className="num" style={{ width: 70 }}>Level</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordered.slice(0, 60).map(row => (
                      <tr key={row.id}>
                        <td className="mono tiny">{row.path}</td>
                        <td className="num"><span className="badge">{row.level}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {ordered.length > 60 && (
              <p className="tiny muted">Showing the first 60 paths. The template uses the same convention.</p>
            )}
          </Card>

          <Card title="Handbook data" sub="Why the catalogue is not bundled">
            <p className="small muted">{HANDBOOK_NOTE}</p>
            <p className="tiny muted" style={{ marginTop: 10 }}>
              If you hold a licensed NPRD or MIL‑HDBK‑217F extract, shape it as Name, Lambda and import it.
              Method is recorded as <span className="mono">imported</span> so the provenance survives review.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

function buildTree(rows: any[]) {
  const byParent = new Map<string | null, any[]>();
  for (const row of rows) {
    const key = row.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(row);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }
  return byParent;
}

function flatten(byParent: Map<string | null, any[]>, parent: string | null, depth: number, out: any[] = []) {
  for (const row of byParent.get(parent) ?? []) {
    out.push({ ...row, path: "", parentPath: "" });
    flatten(byParent, row.id, depth + 1, out);
  }
  return out;
}
