import Link from "next/link";
import {
  deleteReportAction,
  generateReportAction,
  regenerateReportAction,
} from "@/lib/actions";
import { Badge, Card, Empty, Field, Notice, PageHead } from "@/components/ui";
import { ConfirmForm } from "@/components/ConfirmForm";
import { MODULE_LIST } from "@/lib/constants";
import { auditRows, reportRows } from "@/lib/repo";
import { requireActiveProject } from "@/lib/session";
import { fmtInt, relative } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reports" };

const REPORTABLE = ["pbs", "register", "fmeca", "pm", "spares", "safety", "fta", "rbd"] as const;

const MODULE_HINT: Record<string, string> = {
  pbs: "Hierarchy with part numbers, quantities and rolled-up λ",
  register: "λ and MTTR per component with method and source",
  fmeca: "Criticality, α, β, λ used and Cm",
  pm: "Maintenance plan with intervals and due dates",
  spares: "Demand model, reorder points and recommended buys",
  safety: "Hazard register, residual risk and ALARP",
  fta: "Fault tree nodes and top-event probability",
  rbd: "Block diagram, stage reliabilities and system R",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ generated?: string }>;
}) {
  const { generated } = await searchParams;
  const ctx = await requireActiveProject();
  const projectId = ctx.project.id;
  ctx.requireRead("reports");
  const grants = ctx.access("reports");

  const reports = reportRows(ctx.db, projectId);
  const events = auditRows(ctx.db, ctx.user.company_id, projectId)
    .filter((event) => event.entity === "report" || event.entity === "import")
    .slice(0, 12);
  const versions = ctx.db
    .prepare("SELECT COUNT(*) AS n FROM analysis_versions WHERE project_id = ?")
    .get(projectId) as any;

  return (
    <>
      <PageHead
        eyebrow="09 · Reports"
        title="Report pack"
        desc="Every report is generated from a frozen snapshot of the revision it was built from. Download it later and the numbers are exactly what the analysis said at that moment."
        formula="report = snapshot(revision, modules)"
      >
        <a className="btn" href={`/api/import/template`}>
          Import template
        </a>
      </PageHead>

      {generated ? (
        <div style={{ marginBottom: 14 }}>
          <Notice tone="ok">
            Report generated from the current revision. Download it below — the snapshot is already frozen.
          </Notice>
        </div>
      ) : null}


      <div className="split" style={{ marginTop: 16 }}>
        <Card
          title="Generate a report"
          sub="Pick the modules to include. The workbook is written from a snapshot taken at this revision."
        >
          {grants.write ? (
            <form action={generateReportAction}>
              <input type="hidden" name="projectId" value={projectId} />
              <Field label="Report label" hint="Shown in the report list and the audit trail">
                <input
                  className="input"
                  name="label"
                  placeholder={`Revision ${ctx.project.rev} — issue pack`}
                  defaultValue={`Revision ${ctx.project.rev}`}
                />
              </Field>
              <div className="section-title" style={{ marginTop: 14 }}>
                Sheets
              </div>
              <div className="stack" style={{ gap: 6 }}>
                {REPORTABLE.map((key) => {
                  const module = MODULE_LIST.find((m) => m.key === key);
                  const access = ctx.access(key);
                  return (
                    <label
                      className="check"
                      key={key}
                      style={{
                        alignItems: "flex-start",
                        padding: "7px 9px",
                        border: "1px solid var(--line)",
                        borderRadius: 8,
                        opacity: access.read ? 1 : 0.5,
                      }}
                    >
                      <input
                        type="checkbox"
                        name="modules"
                        value={key}
                        defaultChecked={access.read}
                        disabled={!access.read}
                      />
                      <span>
                        <span className="small strong">
                          {module?.num} · {module?.name}
                        </span>
                        <span className="tiny muted" style={{ display: "block" }}>
                          {access.read ? MODULE_HINT[key] : "Not licensed or not granted — cannot be included"}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="row end" style={{ marginTop: 14 }}>
                <button className="btn btn-primary" type="submit">
                  Generate report pack
                </button>
              </div>
            </form>
          ) : (
            <p className="small muted">
              You can download existing reports but not generate new ones. Ask a company admin for write
              access to Reports.
            </p>
          )}
        </Card>

        <div className="stack">
          <Card title="What a snapshot contains" sub="The full input set, not just the calculated output">
            <ul className="small muted" style={{ margin: 0, paddingLeft: 16, lineHeight: 1.7 }}>
              <li>The project record, revision and every selected table at that moment.</li>
              <li>FMECA rows keep the λ they were priced with, so the report cannot drift.</li>
              <li>FTA and RBD results are stored as they stood, not recomputed at download time.</li>
              <li>Download rebuilds the workbook from the snapshot only.</li>
            </ul>
            <div className="hr" />
            <dl className="kv">
              <dt>Format</dt>
              <dd>XLSX, one sheet per module</dd>
              <dt>Revision</dt>
              <dd className="mono">{ctx.project.rev}</dd>
              <dt>Cover sheet</dt>
              <dd>Project, revision, generation time, module list</dd>
            </dl>
          </Card>

          <Card title="Third-party tools" sub="Why the packs are Excel-first">
            <p className="small muted">
              Reliability evidence usually has to live inside a customer&apos;s own workbook, review pack or
              PLM export. Each sheet is written as flat rows with a header row, so it can be filtered,
              pivoted or merged without cleaning.
            </p>
            <p className="tiny muted" style={{ marginTop: 10 }}>
              No formatting is baked into the data sheets beyond column widths — the numbers stay numbers.
            </p>
          </Card>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card
          title="Generated reports"
          sub={`${reports.length} pack${reports.length === 1 ? "" : "s"} · download rebuilds the workbook from the frozen snapshot`}
          body="tight"
        >
          {reports.length === 0 ? (
            <Empty title="No reports yet">
              Pick the modules above and generate the first pack.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 54 }}>#</th>
                    <th>File</th>
                    <th className="num" style={{ width: 70 }}>Rev</th>
                    <th>Modules</th>
                    <th>Snapshot label</th>
                    <th>Generated by</th>
                    <th>When</th>
                    <th style={{ width: 210 }} />
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => {
                    let modules: string[] = [];
                    try {
                      modules = JSON.parse(report.modules);
                    } catch {
                      modules = [];
                    }
                    return (
                      <tr key={report.id}>
                        <td className="num muted">{report.revision}</td>
                        <td>
                          <div className="mono small">{report.file_name ?? `${report.id}.xlsx`}</div>
                          <div className="tiny muted">{report.format.toUpperCase()} · {report.status}</div>
                        </td>
                        <td className="num">
                          <Badge tone="neutral">{report.version_rev ?? "—"}</Badge>
                        </td>
                        <td>
                          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                            {modules.map((module) => (
                              <span className="chip" key={module}>
                                {module}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="small muted">{report.version_label ?? "—"}</td>
                        <td className="small">{report.generated_by_name ?? "system"}</td>
                        <td className="small muted nowrap" title={report.generated_at}>
                          {relative(report.generated_at)}
                        </td>
                        <td>
                          <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                            <a
                              className="btn btn-sm btn-primary"
                              href={`/api/reports/${report.id}/download`}
                            >
                              Download
                            </a>
                            {grants.write ? (
                              <>
                                <form action={regenerateReportAction} style={{ display: "inline" }}>
                                  <input type="hidden" name="projectId" value={projectId} />
                                  <input type="hidden" name="id" value={report.id} />
                                  <button
                                    className="btn btn-sm"
                                    type="submit"
                                    title="Take a new snapshot at the current revision"
                                  >
                                    Regen
                                  </button>
                                </form>
                                <ConfirmForm
                                  action={deleteReportAction}
                                  confirm="Delete this report? The stored snapshot stays available to other reports."
                                  style={{ display: "inline" }}
                                >
                                  <input type="hidden" name="projectId" value={projectId} />
                                  <input type="hidden" name="id" value={report.id} />
                                  <button className="btn btn-sm btn-danger" type="submit">
                                    ×
                                  </button>
                                </ConfirmForm>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="split" style={{ marginTop: 16 }}>
        <Card title="Report and import history" sub="The same events a reviewer sees" body="tight">
          {events.length === 0 ? (
            <Empty title="No report activity yet" />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Entity</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td className="small muted nowrap">{relative(event.at)}</td>
                      <td className="small">{event.actor_name ?? "system"}</td>
                      <td>
                        <span className="chip">{event.entity}</span>
                      </td>
                      <td className="small">{event.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Reproduce a number" sub="What to do when two people disagree">
          <ol className="small muted" style={{ margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
            <li>Open the report in the list and note its revision and snapshot label.</li>
            <li>Download it — the workbook is rebuilt from that stored snapshot.</li>
            <li>Compare a derived cell to the input sheet behind it, e.g. Cm against λ used.</li>
            <li>If the live analysis has moved on, regenerate to get a new pack at the current revision.</li>
          </ol>
          <p className="tiny muted" style={{ marginTop: 12 }}>
            A report is evidence, so it never silently changes. Regenerating creates a new pack instead of
            overwriting the old one.
          </p>
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <Link className="btn btn-sm" href={`/fmeca`}>
              FMECA
            </Link>
            <Link className="btn btn-sm" href={`/import`}>
              Import
            </Link>
            <Link className="btn btn-sm" href={`/settings`}>
              Settings
            </Link>
          </div>
        </Card>
      </div>
    </>
  );
}