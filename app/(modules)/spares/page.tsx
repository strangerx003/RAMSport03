import { addSpareItemAction, deleteSpareItemAction, saveSpareItemsAction } from "@/lib/actions";
import { Badge, Card, Empty, Field, Notice, PageHead } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmForm";
import { componentRows, sparesRows } from "@/lib/repo";
import { requireActiveProject } from "@/lib/session";
import { fmt, fmtInt, fmtLambda, money, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "Spares" };

export default async function SparesPage() {
  const ctx = await requireActiveProject();
  const projectId = ctx.project.id;
  ctx.requireRead("spares");
  const grants = ctx.access("spares");

  const rows = sparesRows(ctx.db, projectId);
  const components = componentRows(ctx.db, projectId);
  const covered = new Set(rows.map((row) => row.pbs_node_id));
  const missing = components.filter((component) => !covered.has(component.id));

  const inventoryValue = rows.reduce((sum, row) => sum + (row.qty_on_hand || 0) * (row.unit_cost_cents || 0), 0);
  const belowReorder = rows.filter((row) => row.below_reorder);
  const recommendedValue = rows.reduce((sum, row) => sum + (row.model.recommendedQty || 0) * (row.unit_cost_cents || 0), 0);
  const avgFill = rows.length ? rows.reduce((sum, row) => sum + (row.model.fillRate || 0), 0) / rows.length : 1;
  const totalAnnualDemand = rows.reduce((sum, row) => sum + row.model.annualDemand, 0);

  return (
    <>
      <PageHead
        eyebrow="05 · Spare Parts"
        title="Spares"
        desc="Poisson demand from the live λ, a service-level safety stock and a reorder point. Quantities are per component line, so a pack of six switches demands six times the failures."
        formula="ROP = μ + z·√μ   ·   μ = λ · operating hours · lead time"
      >
        <a className="btn" href={`/api/export/spares?projectId=${projectId}`}>
          Export spares
        </a>
      </PageHead>


      {belowReorder.length ? (
        <div style={{ marginTop: 14 }}>
          <Notice tone="danger">
            <strong>{belowReorder.length} lines are below their reorder point.</strong> The largest gap is{" "}
            {belowReorder[0]?.node_name} at {Math.round(belowReorder[0]?.gap ?? 0)} units. Order before the
            next maintenance window.
          </Notice>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <Card title="Spares plan" sub="λ comes from register · cost is per unit · MOQ lifts small recommendations" body="tight">
          {rows.length === 0 ? (
            <Empty title="No spare items yet">Add the first spare below.</Empty>
          ) : (
            <form action={saveSpareItemsAction}>
              <input type="hidden" name="projectId" value={projectId} />
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ minWidth: 150 }}>Component</th>
                      <th className="num" style={{ width: 86 }}>λ /10⁶h</th>
                      <th className="num" style={{ width: 74 }}>On hand</th>
                      <th className="num" style={{ width: 84 }}>Lead days</th>
                      <th className="num" style={{ width: 64 }}>MOQ</th>
                      <th className="num" style={{ width: 90 }}>Unit cost</th>
                      <th className="num" style={{ width: 84 }}>Service</th>
                      <th className="num" style={{ width: 84 }}>Recommended</th>
                      <th className="num" style={{ width: 74 }}>ROP</th>
                      <th className="num" style={{ width: 74 }}>Safety</th>
                      <th className="num" style={{ width: 70 }}>Gap</th>
                      <th className="num" style={{ width: 100 }}>Value</th>
                      <th style={{ width: 44 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className={row.below_reorder ? "stale" : undefined}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{row.node_name}</div>
                          <div className="mono tiny muted">
                            {row.part_number ?? "—"} · qty {fmt(row.node_quantity, 0)}
                          </div>
                        </td>
                        <td className="num">{fmtLambda(row.lambda)}</td>
                        <td className="num">
                          <input className="input sm num" type="number" min="0" step="1" name={`onhand_${row.id}`} defaultValue={row.qty_on_hand} disabled={!grants.write} />
                        </td>
                        <td className="num">
                          <input className="input sm num" type="number" min="0" step="1" name={`lead_${row.id}`} defaultValue={row.lead_time_days} disabled={!grants.write} />
                        </td>
                        <td className="num">
                          <input className="input sm num" type="number" min="1" step="1" name={`moq_${row.id}`} defaultValue={row.moq} disabled={!grants.write} />
                        </td>
                        <td className="num">
                          <input
                            className="input sm num"
                            type="number"
                            min="0"
                            step="1"
                            name={`cost_${row.id}`}
                            defaultValue={Math.round((row.unit_cost_cents || 0) / 100)}
                            disabled={!grants.write}
                          />
                        </td>
                        <td className="num">
                          <input
                            className="input sm num"
                            type="number"
                            min="0.5"
                            max="0.999"
                            step="0.005"
                            name={`service_${row.id}`}
                            defaultValue={row.service_level}
                            disabled={!grants.write}
                          />
                        </td>
                        <td className="num strong">{fmtInt(row.recommended_qty)}</td>
                        <td className="num">{fmtInt(row.reorder_point)}</td>
                        <td className="num">{fmtInt(row.safety_stock)}</td>
                        <td className="num">
                          {row.gap > 0 ? (
                            <Badge tone="danger">+{fmtInt(row.gap)}</Badge>
                          ) : row.gap < 0 ? (
                            <Badge tone="warn">{fmtInt(row.gap)}</Badge>
                          ) : (
                            <Badge tone="ok">0</Badge>
                          )}
                        </td>
                        <td className="num">{money((row.qty_on_hand || 0) * (row.unit_cost_cents || 0))}</td>
                        <td>
                          {grants.write ? (
                            <ConfirmButton
                              confirm={`Delete the spare line for ${row.node_name}?`}
                              formAction={deleteSpareItemAction}
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
                  <span>Recommended quantity and ROP are recomputed on save from λ, lead time and service level.</span>
                  <span className="spacer" />
                  <button className="btn btn-primary btn-sm" type="submit">
                    Save spares
                  </button>
                </div>
              ) : null}
            </form>
          )}
        </Card>
      </div>

      <div className="split" style={{ marginTop: 16 }}>
        {grants.write ? (
          <Card title="Add a spare line" sub="One line per component; existing lines are updated rather than duplicated">
            <form action={addSpareItemAction}>
              <input type="hidden" name="projectId" value={projectId} />
              <div className="form-grid three">
                <Field label="Component" span>
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
                <Field label="On hand">
                  <input className="input num" type="number" min="0" step="1" name="qtyOnHand" defaultValue={0} />
                </Field>
                <Field label="Lead time (days)">
                  <input className="input num" type="number" min="0" step="1" name="leadTimeDays" defaultValue={30} />
                </Field>
                <Field label="MOQ">
                  <input className="input num" type="number" min="1" step="1" name="moq" defaultValue={1} />
                </Field>
                <Field label="Unit cost (USD)">
                  <input className="input num" type="number" min="0" step="1" name="unitCost" defaultValue={0} />
                </Field>
                <Field label="Service level" hint="0.95 means a 95% chance of no stockout during lead time">
                  <input className="input num" type="number" min="0.5" max="0.999" step="0.005" name="serviceLevel" defaultValue={0.95} />
                </Field>
              </div>
              <div className="row end" style={{ marginTop: 12 }}>
                <button className="btn btn-primary btn-sm" type="submit">
                  Add spare
                </button>
              </div>
            </form>
            {missing.length ? (
              <p className="tiny muted" style={{ marginTop: 10 }}>
                {missing.length} components have no spare line.{" "}
                {missing.slice(0, 4).map((component) => component.name).join(", ")}
                {missing.length > 4 ? "…" : ""}
              </p>
            ) : null}
          </Card>
        ) : (
          <Card title="Read-only access">
            <p className="small muted">You can read the spares plan but not change quantities or costs.</p>
          </Card>
        )}

        <Card title="How the quantity is sized" sub="Demand during lead time, not annual demand">
          <div className="stack" style={{ gap: 9 }}>
            <div>
              <div className="label">1 · Demand rate</div>
              <p className="small muted">λ × operating hours × quantity = expected failures per year.</p>
            </div>
            <div>
              <div className="label">2 · Lead-time demand</div>
              <p className="small muted">μ = annual demand × lead days / 365. This is what the Poisson uses.</p>
            </div>
            <div>
              <div className="label">3 · Safety stock</div>
              <p className="small muted">z(service level) × √μ, rounded up. z comes from the inverse normal.</p>
            </div>
            <div>
              <div className="label">4 · Recommended buy</div>
              <p className="small muted">The Poisson quantile at the chosen service level, raised to MOQ where needed.</p>
            </div>
          </div>
          <div className="row" style={{ marginTop: 12, gap: 6 }}>
            <span className="chip">λ live from register</span>
            <span className="chip">lead time from the supplier</span>
          </div>
        </Card>
      </div>
    </>
  );
}