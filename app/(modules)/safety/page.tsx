import Link from "next/link";
import { addHazardAction, deleteHazardAction, saveHazardsAction } from "@/lib/actions";
import { Badge, Card, Empty, Field, Notice, PageHead } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmForm";
import { componentRows, hazardRows } from "@/lib/repo";
import { requireActiveProject } from "@/lib/session";
import { fmtInt, relative } from "@/lib/format";
import { LIKELIHOOD_LABEL, SEVERITY_LABEL, riskBand, riskScore } from "@/lib/calc";

export const dynamic = "force-dynamic";

export const metadata = { title: "Safety" };

function controlsToText(controls: any[]): string {
  return (controls ?? [])
    .map((control) => `${control.level ? `${control.level}: ` : ""}${control.control ?? ""}`)
    .join("\n");
}

export default async function SafetyPage() {
  const ctx = await requireActiveProject();
  const projectId = ctx.project.id;
  ctx.requireRead("safety");
  const grants = ctx.access("safety");

  const rows = hazardRows(ctx.db, projectId);
  const components = componentRows(ctx.db, projectId);
  const unacceptable = rows.filter((row) => row.alarp === "unacceptable");
  const alarp = rows.filter((row) => row.alarp === "alarp");
  const acceptable = rows.filter((row) => row.alarp === "acceptable");
  const verified = rows.reduce(
    (sum, row) => sum + (row.controls_list ?? []).filter((control: any) => control.verified_at).length,
    0,
  );
  const totalControls = rows.reduce((sum, row) => sum + (row.controls_list ?? []).length, 0);

  const cells = new Map<string, number>();
  for (const row of rows) {
    const s = row.residual_severity ?? row.severity;
    const l = row.residual_likelihood ?? row.likelihood;
    cells.set(`${s}-${l}`, (cells.get(`${s}-${l}`) ?? 0) + 1);
  }

  return (
    <>
      <PageHead
        eyebrow="06 · Safety Analysis"
        title="Hazard register"
        desc="Severity and likelihood before and after controls, with an ALARP judgement. Residual risk drives the colour, not the initial score."
        formula="risk = severity × likelihood   ·   residual → ALARP"
      >
        <Link className="btn" href={`/fta`}>
          Fault tree →
        </Link>
      </PageHead>


      {unacceptable.length ? (
        <div style={{ marginTop: 14 }}>
          <Notice tone="danger">
            <strong>{unacceptable.length} hazards are unacceptable after controls.</strong> Either add a
            control that genuinely reduces likelihood, or record why the risk is accepted. The report will
            carry this state.
          </Notice>
        </div>
      ) : null}

      <div className="split" style={{ marginTop: 16 }}>
        <Card title="Hazard register" sub="One line per hazard · residual S/L is what counts" body="tight">
          {rows.length === 0 ? (
            <Empty title="No hazards yet">Add the first hazard below.</Empty>
          ) : (
            <form action={saveHazardsAction}>
              <input type="hidden" name="projectId" value={projectId} />
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ minWidth: 200 }}>Hazard</th>
                      <th style={{ minWidth: 120 }}>Component</th>
                      <th className="num" style={{ width: 54 }}>S</th>
                      <th className="num" style={{ width: 54 }}>L</th>
                      <th style={{ minWidth: 190 }}>Controls</th>
                      <th className="num" style={{ width: 54 }}>rS</th>
                      <th className="num" style={{ width: 54 }}>rL</th>
                      <th className="num" style={{ width: 70 }}>Residual</th>
                      <th style={{ width: 110 }}>ALARP</th>
                      <th style={{ width: 44 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <textarea
                            className="textarea"
                            style={{ minHeight: 54, fontSize: 12.5 }}
                            name={`desc_${row.id}`}
                            defaultValue={row.description}
                            disabled={!grants.write}
                          />
                        </td>
                        <td className="small muted">{row.node_name ?? "—"}</td>
                        <td className="num">
                          <input className="input sm num" type="number" min="1" max="4" name={`sev_${row.id}`} defaultValue={row.severity} disabled={!grants.write} />
                        </td>
                        <td className="num">
                          <input className="input sm num" type="number" min="1" max="5" name={`lik_${row.id}`} defaultValue={row.likelihood} disabled={!grants.write} />
                        </td>
                        <td>
                          <textarea
                            className="textarea"
                            style={{ minHeight: 54, fontSize: 11.5 }}
                            name={`controls_${row.id}`}
                            defaultValue={controlsToText(row.controls_list)}
                            placeholder={"Design: redundant bus\nProcedure: pre-flight check"}
                            disabled={!grants.write}
                          />
                          <div className="tiny muted">{row.controls_list?.length ?? 0} control(s)</div>
                        </td>
                        <td className="num">
                          <input className="input sm num" type="number" min="1" max="4" name={`rsev_${row.id}`} defaultValue={row.residual_severity ?? ""} disabled={!grants.write} />
                        </td>
                        <td className="num">
                          <input className="input sm num" type="number" min="1" max="5" name={`rlik_${row.id}`} defaultValue={row.residual_likelihood ?? ""} disabled={!grants.write} />
                        </td>
                        <td className="num">
                          <Badge tone={row.residual_band === "critical" ? "danger" : row.residual_band === "high" ? "danger" : row.residual_band === "medium" ? "warn" : "ok"}>
                            {row.residual_risk}
                          </Badge>
                        </td>
                        <td>
                          <Badge tone={row.alarp === "unacceptable" ? "danger" : row.alarp === "alarp" ? "warn" : "ok"}>{row.alarp}</Badge>
                        </td>
                        <td>
                          {grants.write ? (
                            <ConfirmButton
                              confirm={`Delete the hazard "${row.description}"?`}
                              formAction={deleteHazardAction}
                              name="id"
                              value={row.id}
                              className="btn btn-sm btn-danger"
                            >
                              ×
                            </ConfirmButton>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {grants.write ? (
                <div className="savebar">
                  <span>ALARP is recomputed from residual S and L on save. Leave residual blank to use the initial score.</span>
                  <span className="spacer" />
                  <button className="btn btn-primary btn-sm" type="submit">
                    Save register
                  </button>
                </div>
              ) : null}
            </form>
          )}
        </Card>

        <div className="stack">
          <Card title="Residual risk matrix" sub="Count of hazards in each cell">
            <div className="matrix">
              <div className="matrix-head" />
              {[1, 2, 3, 4, 5].map((l) => (
                <div className="matrix-head" key={l} title={LIKELIHOOD_LABEL[l]}>
                  L{l}
                </div>
              ))}
              {[4, 3, 2, 1].map((s) => (
                <div key={s} style={{ display: "contents" }}>
                  <div className="matrix-rowlabel" title={SEVERITY_LABEL[s]}>
                    S{s}
                  </div>
                  {[1, 2, 3, 4, 5].map((l) => {
                    const count = cells.get(`${s}-${l}`) ?? 0;
                    const score = riskScore(s, l);
                    const band = riskBand(score);
                    return (
                      <div
                        className={`matrix-cell ${band === "low" ? "band-low" : band === "medium" ? "band-medium" : band === "high" ? "band-high" : "band-critical"}`}
                        key={l}
                        title={`${SEVERITY_LABEL[s]} × ${LIKELIHOOD_LABEL[l]} = ${score}`}
                      >
                        {count || ""}
                        <small>{score}</small>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="legend" style={{ marginTop: 10 }}>
              <span>
                <span className="dot" style={{ background: "#63d99b" }} /> acceptable
              </span>
              <span>
                <span className="dot" style={{ background: "#ffd166" }} /> ALARP
              </span>
              <span>
                <span className="dot" style={{ background: "#e04b38" }} /> unacceptable
              </span>
            </div>
          </Card>

          <Card title="What ALARP means here" sub="The rule the app actually applies">
            <ul className="small muted" style={{ margin: 0, paddingLeft: 16, lineHeight: 1.7 }}>
              <li>Score ≥ 12, or catastrophic with likelihood ≥ 3: <strong>unacceptable</strong>.</li>
              <li>Score ≤ 4 with severity ≤ 2: <strong>acceptable</strong>.</li>
              <li>Everything else: <strong>ALARP</strong> — tolerable only with evidence that further reduction is disproportionate.</li>
            </ul>
            <p className="tiny muted" style={{ marginTop: 10 }}>
              This is a defensible default, not a substitute for your own safety management system. Override
              it in review by recording the rationale.
            </p>
          </Card>
        </div>
      </div>

      {grants.write ? (
        <div style={{ marginTop: 16 }}>
          <Card title="Add a hazard" sub="Controls are one per line; prefix with Design, Procedure, Training, Warning or PPE">
            <form action={addHazardAction}>
              <input type="hidden" name="projectId" value={projectId} />
              <div className="form-grid three">
                <Field label="Hazard" span>
                  <input className="input" name="description" placeholder="e.g. Loss of flight control after power bus failure" required />
                </Field>
                <Field label="Component">
                  <select className="select" name="nodeId" defaultValue="">
                    <option value="">(not tied to a component)</option>
                    {components.map((component) => (
                      <option value={component.id} key={component.id}>
                        {component.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Severity (1–4)" hint="1 negligible · 2 marginal · 3 critical · 4 catastrophic">
                  <input className="input num" type="number" min="1" max="4" name="severity" defaultValue={3} />
                </Field>
                <Field label="Likelihood (1–5)" hint="1 improbable · 5 frequent">
                  <input className="input num" type="number" min="1" max="5" name="likelihood" defaultValue={3} />
                </Field>
                <Field label="Controls" span hint="Example: Design: redundant power bus and isolation diodes">
                  <textarea className="textarea" name="controls" />
                </Field>
                <Field label="Residual severity">
                  <input className="input num" type="number" min="1" max="4" name="residualSeverity" />
                </Field>
                <Field label="Residual likelihood">
                  <input className="input num" type="number" min="1" max="5" name="residualLikelihood" />
                </Field>
              </div>
              <div className="row end" style={{ marginTop: 12 }}>
                <button className="btn btn-primary btn-sm" type="submit">
                  Add hazard
                </button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <Card title="Control evidence" sub="A control without evidence is an intention, not a mitigation">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Hazard</th>
                  <th>Control</th>
                  <th>Level</th>
                  <th>Verified</th>
                </tr>
              </thead>
              <tbody>
                {rows.flatMap((row) =>
                  (row.controls_list?.length ? row.controls_list : [null]).map((control: any, index: number) => (
                    <tr key={`${row.id}-${index}`}>
                      <td className="small">{index === 0 ? row.description : ""}</td>
                      <td className="small">{control?.control ?? "—"}</td>
                      <td>
                        <span className="chip">{control?.level ?? "—"}</span>
                      </td>
                      <td className="small">
                        {control?.verified_at ? (
                          <Badge tone="ok">{relative(control.verified_at)}</Badge>
                        ) : (
                          <Badge tone="warn">not verified</Badge>
                        )}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}