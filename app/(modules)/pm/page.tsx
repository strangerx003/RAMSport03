import {
  addMaintenanceTaskAction,
  completeMaintenanceTaskAction,
  deleteMaintenanceTaskAction,
  generatePmFromFmecaAction,
  saveMaintenanceTasksAction,
} from "@/lib/actions";
import { Badge, Card, Empty, Field, Notice, PageHead } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmForm";
import { PM_UNITS } from "@/lib/constants";
import { componentRows, pmRows } from "@/lib/repo";
import { requireActiveProject } from "@/lib/session";
import { dateOnly, fmt, fmtInt, hours } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "PM" };

export default async function PmPage() {
  const ctx = await requireActiveProject();
  const projectId = ctx.project.id;
  ctx.requireRead("pm");
  const grants = ctx.access("pm");

  const rows = pmRows(ctx.db, projectId);
  const components = componentRows(ctx.db, projectId);
  const overdue = rows.filter((row) => row.overdue);
  const dueSoon = rows.filter((row) => row.due_soon);
  const next = rows.filter((row) => row.next_due_at).sort((a, b) => String(a.next_due_at).localeCompare(String(b.next_due_at)))[0];
  const labour = rows.reduce((sum, row) => sum + (row.manpower || 1), 0);

  return (
    <>
      <PageHead
        eyebrow="04 · Preventive Maintenance"
        title="Maintenance plan"
        desc="Time-based and condition-based tasks with their next due date. Completing a task rolls it forward by its own interval; FMECA actions can seed the plan."
        formula="next = last done + interval"
      >
        {grants.write ? (
          <form action={generatePmFromFmecaAction}>
            <input type="hidden" name="projectId" value={projectId} />
            <button className="btn" type="submit">
              Generate from FMECA
            </button>
          </form>
        ) : null}
      </PageHead>


      {overdue.length ? (
        <div style={{ marginTop: 14 }}>
          <Notice tone="danger">
            <strong>{overdue.length} tasks are overdue.</strong> The oldest is{" "}
            {overdue[0]?.description} on {overdue[0]?.node_name}.
          </Notice>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <Card title="Tasks" sub={`${rows.length} tasks · dates are stored, intervals are editable`} body="tight">
          {rows.length === 0 ? (
            <Empty title="No maintenance tasks yet">
              Add a task below, or generate one from a FMECA action.
            </Empty>
          ) : (
            <form action={saveMaintenanceTasksAction}>
              <input type="hidden" name="projectId" value={projectId} />
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ minWidth: 150 }}>Component</th>
                      <th style={{ minWidth: 220 }}>Task</th>
                      <th style={{ width: 110 }}>Strategy</th>
                      <th className="num" style={{ width: 90 }}>Every</th>
                      <th style={{ width: 100 }}>Unit</th>
                      <th className="num" style={{ width: 80 }}>People</th>
                      <th style={{ width: 140 }}>Last done</th>
                      <th className="num" style={{ width: 110 }}>Next due</th>
                      <th className="num" style={{ width: 90 }}>Status</th>
                      <th style={{ width: 150 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className={row.overdue ? "stale" : undefined}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{row.node_name}</div>
                          <div className="mono tiny muted">{row.part_number ?? "—"}</div>
                        </td>
                        <td>
                          <input className="inline-input" name={`desc_${row.id}`} defaultValue={row.description} disabled={!grants.write} />
                        </td>
                        <td>
                          <select className="select sm" name={`strategy_${row.id}`} defaultValue={row.strategy} disabled={!grants.write}>
                            <option value="time">time</option>
                            <option value="condition">condition</option>
                          </select>
                        </td>
                        <td className="num">
                          <input
                            className="input sm num"
                            type="number"
                            min="0.01"
                            step="any"
                            name={`interval_${row.id}`}
                            defaultValue={row.interval_value}
                            disabled={!grants.write}
                          />
                        </td>
                        <td>
                          <select className="select sm" name={`unit_${row.id}`} defaultValue={row.interval_unit} disabled={!grants.write}>
                            {PM_UNITS.map((unit) => (
                              <option value={unit} key={unit}>
                                {unit}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="num">
                          <input
                            className="input sm num"
                            type="number"
                            min="1"
                            step="1"
                            name={`manpower_${row.id}`}
                            defaultValue={row.manpower}
                            disabled={!grants.write}
                          />
                        </td>
                        <td>
                          <input
                            className="input sm"
                            type="date"
                            name={`last_${row.id}`}
                            defaultValue={dateOnly(row.last_done_at) === "—" ? "" : dateOnly(row.last_done_at)}
                            disabled={!grants.write}
                          />
                        </td>
                        <td className="num">{dateOnly(row.next_due_at)}</td>
                        <td className="num">
                          {row.overdue ? (
                            <Badge tone="danger">{Math.abs(row.days_until ?? 0)} d late</Badge>
                          ) : row.due_soon ? (
                            <Badge tone="warn">in {row.days_until} d</Badge>
                          ) : row.days_until != null ? (
                            <Badge tone="ok">in {row.days_until} d</Badge>
                          ) : (
                            <Badge tone="neutral">unscheduled</Badge>
                          )}
                        </td>
                        <td>
                          {grants.write ? (
                            <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                              <ConfirmButton
                                className="btn btn-sm"
                                formAction={completeMaintenanceTaskAction}
                                name="id"
                                value={row.id}
                                title="Mark done today and roll forward"
                              >
                                Done
                              </ConfirmButton>
                              <ConfirmButton
                                confirm={`Delete the task "${row.description}"?`}
                                formAction={deleteMaintenanceTaskAction}
                                name="id"
                                value={row.id}
                                className="btn btn-sm btn-danger"
                              >
                                ×
                              </ConfirmButton>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {grants.write ? (
                <div className="savebar">
                  <span>Editing an interval re-dates the next due from the last completion.</span>
                  <span className="spacer" />
                  <button className="btn btn-primary btn-sm" type="submit">
                    Save plan
                  </button>
                </div>
              ) : null}
            </form>
          )}
        </Card>
      </div>

      {grants.write ? (
        <div style={{ marginTop: 16 }}>
          <Card title="Add a task" sub="Time-based or condition-based; the interval drives the due date">
            <form action={addMaintenanceTaskAction}>
              <input type="hidden" name="projectId" value={projectId} />
              <div className="form-grid three">
                <Field label="Component">
                  <select className="select" name="nodeId" required defaultValue="">
                    <option value="" disabled>
                      Choose a component…
                    </option>
                    {components.map((component) => (
                      <option value={component.id} key={component.id}>
                        {component.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Task" span>
                  <input className="input" name="description" placeholder="e.g. Actuator strip-down and re-grease" required />
                </Field>
                <Field label="Strategy">
                  <select className="select" name="strategy" defaultValue="time">
                    <option value="time">time</option>
                    <option value="condition">condition</option>
                  </select>
                </Field>
                <Field label="Interval">
                  <input className="input num" type="number" min="0.01" step="any" name="intervalValue" defaultValue={90} />
                </Field>
                <Field label="Unit">
                  <select className="select" name="intervalUnit" defaultValue="days">
                    {PM_UNITS.map((unit) => (
                      <option value={unit} key={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="People">
                  <input className="input num" type="number" min="1" step="1" name="manpower" defaultValue={1} />
                </Field>
                <Field label="Last done">
                  <input className="input" type="date" name="lastDone" />
                </Field>
              </div>
              <div className="row end" style={{ marginTop: 12 }}>
                <button className="btn btn-primary btn-sm" type="submit">
                  Add task
                </button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <Card title="Where the dates come from" sub="The plan is a consequence of the analysis, not a separate list">
          <div className="grid cols-3">
            <div>
              <div className="label">From FMECA</div>
              <p className="small muted">
                Rows with an action generate an inspection task. Interval defaults to 90, 180 or 365 days
                depending on Cm, so the highest criticality gets the tightest interval.
              </p>
            </div>
            <div>
              <div className="label">From the interval</div>
              <p className="small muted">
                Days, weeks, months, hours or cycles. Completing a task sets last-done to now and rolls the
                next due forward by exactly one interval.
              </p>
            </div>
            <div>
              <div className="label">What it feeds</div>
              <p className="small muted">
                Spares demand uses the same operating hours, so a spare can be sized against the task
                interval. Reports freeze the plan with the revision.
              </p>
            </div>
          </div>
          <div className="row" style={{ marginTop: 12, gap: 16 }}>
            <span className="chip">tasks {rows.length}</span>
            <span className="chip">overdue {overdue.length}</span>
            <span className="chip">next {hours(ctx.project.operating_hours / Math.max(1, rows.length || 1))} between tasks</span>
          </div>
        </Card>
      </div>
    </>
  );
}