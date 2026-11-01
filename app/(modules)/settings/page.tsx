import Link from "next/link";
import { notFound } from "next/navigation";
import {
  inviteMemberAction,
  removeMemberAction,
  setBundleAction,
  setProjectStatusAction,
  updateMemberAction,
  updateProjectAction,
} from "@/lib/actions";
import { Badge, Card, Empty, Field, PageHead } from "@/components/ui";
import { ConfirmForm } from "@/components/ConfirmForm";
import { BUNDLES, BUNDLE_BY_KEY, MODULE_LIST, ROLES } from "@/lib/constants";
import { auditRows, memberRows } from "@/lib/repo";
import { requireActiveProject } from "@/lib/session";
import { fmt, fmtInt, relative } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

const GRANT_MODULES = MODULE_LIST;

const OK_MESSAGES: Record<string, string> = {
  inputs: "Project inputs saved — downstream analyses have been re-priced.",
  bundle: "Licence bundle updated. Module access reflects the new bundle.",
  status: "Project status updated.",
  invited: "Member added to the project. Set their grants below.",
  grants: "Member role and module grants updated.",
  removed: "Member removed from the project.",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const { ok } = await searchParams;
  const ctx = await requireActiveProject();
  const projectId = ctx.project.id;
  const project = ctx.project;
  const admin = ctx.role === "company_admin" || ctx.role === "super_admin";
  if (!admin && !ctx.member) notFound();

  const members = memberRows(ctx.db, projectId);
  const events = auditRows(ctx.db, ctx.user.company_id, projectId);
  const bundle = BUNDLE_BY_KEY[project.licensed_bundle];
  const enabled = ctx.entitlements;
  const reportCount = (ctx.db.prepare("SELECT COUNT(*) AS n FROM reports WHERE project_id = ?").get(projectId) as any).n;

  return (
    <>
      <PageHead
        eyebrow="Project settings"
        title="Settings and access"
        desc="Model inputs every module reads, the licence bundle, and who can write what. Changes here are audited like any engineering edit."
      >
        <Link className="btn" href={`/reports`}>
          Reports
        </Link>
        <Link className="btn" href={`/projects`}>
          All projects
        </Link>
      </PageHead>

      {ok && OK_MESSAGES[ok] ? <div className="toast">{OK_MESSAGES[ok]}</div> : null}


      <div className="split" style={{ marginTop: 16 }}>
        <Card
          title="Project inputs"
          sub="Changing mission, operating hours or life re-prices the downstream analyses"
        >
          {admin ? (
            <form action={updateProjectAction}>
              <input type="hidden" name="projectId" value={projectId} />
              <div className="form-grid">
                <Field label="Project name" span>
                  <input className="input" name="name" defaultValue={project.name} required />
                </Field>
                <Field label="Project code">
                  <input className="input" name="code" defaultValue={project.code ?? ""} />
                </Field>
                <Field label="Customer">
                  <input className="input" name="customer" defaultValue={project.customer ?? ""} />
                </Field>
                <Field label="Timezone">
                  <input className="input" name="timezone" defaultValue={project.timezone} />
                </Field>
                <Field label="Mission hours" hint="One flight, run or sortie">
                  <input className="input num" type="number" min="1" step="1" name="mission_hours" defaultValue={project.mission_hours} />
                </Field>
                <Field label="Operating hours / year">
                  <input className="input num" type="number" min="1" step="1" name="operating_hours" defaultValue={project.operating_hours} />
                </Field>
                <Field label="Product life (years)">
                  <input className="input num" type="number" min="0.5" step="0.5" name="product_life_years" defaultValue={project.product_life_years} />
                </Field>
              </div>
              <div className="row end" style={{ marginTop: 12 }}>
                <button className="btn btn-primary btn-sm" type="submit">
                  Save inputs
                </button>
              </div>
            </form>
          ) : (
            <dl className="kv">
              <dt>Name</dt>
              <dd>{project.name}</dd>
              <dt>Code</dt>
              <dd>{project.code ?? "—"}</dd>
              <dt>Customer</dt>
              <dd>{project.customer ?? "—"}</dd>
              <dt>Mission</dt>
              <dd>{fmt(project.mission_hours, 0)} h</dd>
              <dt>Operating hours</dt>
              <dd>{fmt(project.operating_hours, 0)} h / year</dd>
              <dt>Life</dt>
              <dd>{fmt(project.product_life_years, 1)} years</dd>
            </dl>
          )}

          <div className="hr" />

          <div className="label">What the numbers mean</div>
          <ul className="small muted" style={{ margin: "8px 0 0", paddingLeft: 16, lineHeight: 1.7 }}>
            <li><strong>Mission hours</strong> sets the default T for FMECA and FTA when a row has no own window.</li>
            <li><strong>Operating hours / year</strong> drives spares demand and annual downtime.</li>
            <li><strong>Product life</strong> gives the FMECA window: operating hours × life.</li>
            <li>Mission time on an RBD is set per model, not here.</li>
          </ul>
        </Card>

        <div className="stack">
          <Card title="Licence bundle" sub="A bundle enables modules for everyone on this project">
            <div className="row" style={{ gap: 8 }}>
              <Badge tone="tier">{bundle?.name ?? project.licensed_bundle}</Badge>
              <span className="tiny muted">{bundle?.note ?? ""}</span>
            </div>
            {admin ? (
              <form action={setBundleAction} style={{ marginTop: 12 }}>
                <input type="hidden" name="projectId" value={projectId} />
                <Field label="Bundle">
                  <select className="select" name="bundle" defaultValue={project.licensed_bundle}>
                    {BUNDLES.map((option) => (
                      <option value={option.key} key={option.key}>
                        {option.name} — {option.count} modules
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="row end" style={{ marginTop: 10 }}>
                  <button className="btn btn-sm" type="submit">
                    Apply bundle
                  </button>
                </div>
              </form>
            ) : (
              <p className="tiny muted" style={{ marginTop: 10 }}>
                Only a company admin can change the licence bundle.
              </p>
            )}

            <div className="hr" />
            <div className="stack" style={{ gap: 6 }}>
              {MODULE_LIST.map((module) => {
                const on = enabled.has(module.key);
                return (
                  <div className="row" key={module.key} style={{ gap: 8 }}>
                    <span className="mono tiny muted" style={{ width: 22 }}>
                      {module.num}
                    </span>
                    <span className="small" style={{ flex: 1 }}>
                      {module.name}
                    </span>
                    <Badge tone={on ? "ok" : "neutral"}>{on ? "enabled" : "off"}</Badge>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Archive" sub="Archiving hides the project from the workspace list">
            <p className="small muted">
              Nothing is deleted. Archived projects keep their hierarchy, reports and audit trail and can be
              restored by a company admin.
            </p>
            {admin ? (
              <form action={setProjectStatusAction} style={{ marginTop: 10 }}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="status" value={project.status === "archived" ? "active" : "archived"} />
                <button className={project.status === "archived" ? "btn btn-sm" : "btn btn-sm btn-danger"} type="submit">
                  {project.status === "archived" ? "Restore project" : "Archive project"}
                </button>
              </form>
            ) : (
              <p className="tiny muted">Status: {project.status}</p>
            )}
          </Card>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card
          title="Members and module grants"
          sub="Admins have full access. Employees get exactly the grants set here. Reviewers are read-only everywhere."
          body="tight"
        >
          {members.length === 0 ? (
            <Empty title="No members" />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ minWidth: 190 }}>Member</th>
                    <th style={{ width: 150 }}>Role</th>
                    {GRANT_MODULES.map((module) => (
                      <th key={module.key} className="num" style={{ width: 46 }} title={module.name}>
                        {module.short.slice(0, 4)}
                      </th>
                    ))}
                    <th style={{ width: 110 }} />
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.user_id}>
                      <td>
                        <div className="strong small">{member.name}</div>
                        <div className="mono tiny muted">{member.email}</div>
                      </td>
                      <td>
                        {admin ? (
                          <form action={updateMemberAction} id={`member-${member.user_id}`}>
                            <input type="hidden" name="projectId" value={projectId} />
                            <input type="hidden" name="userId" value={member.user_id} />
                            <select className="select sm" name="role" defaultValue={member.role}>
                              {ROLES.filter((role) => role.key !== "super_admin").map((role) => (
                                <option value={role.key} key={role.key}>
                                  {role.name}
                                </option>
                              ))}
                            </select>
                          </form>
                        ) : (
                          <Badge tone="info">{ROLES.find((role) => role.key === member.role)?.name ?? member.role}</Badge>
                        )}
                      </td>
                      {GRANT_MODULES.map((module) => {
                        const value = member.role === "company_admin" || member.role === "reviewer"
                          ? "managed"
                          : member.grants[module.key] ?? "none";
                        return (
                          <td className="num" key={module.key}>
                            {admin && !["company_admin", "reviewer"].includes(member.role) ? (
                              <select
                                className="select sm"
                                name={`grant_${module.key}`}
                                defaultValue={member.grants[module.key] ?? "none"}
                                form={`member-${member.user_id}`}
                                aria-label={`${module.name} grant for ${member.name}`}
                              >
                                <option value="none">–</option>
                                <option value="read">R</option>
                                <option value="write">W</option>
                              </select>
                            ) : (
                              <span className="tiny muted">{value === "managed" ? "auto" : value}</span>
                            )}
                          </td>
                        );
                      })}
                      <td>
                        {admin ? (
                          <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                            <button className="btn btn-sm" type="submit" form={`member-${member.user_id}`}>
                              Save
                            </button>
                            <ConfirmForm
                              action={removeMemberAction}
                              confirm={`Remove ${member.name} from this project?`}
                              style={{ display: "inline" }}
                            >
                              <input type="hidden" name="projectId" value={projectId} />
                              <input type="hidden" name="userId" value={member.user_id} />
                              <button className="btn btn-sm btn-danger" type="submit">
                                ×
                              </button>
                            </ConfirmForm>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ padding: "10px 16px", borderTop: "1px solid var(--line)" }} className="tiny muted">
            R = read, W = write, – = no access. Grants only matter for modules inside the licence bundle.
          </div>
        </Card>
      </div>

      {admin ? (
        <div className="split" style={{ marginTop: 16 }}>
          <Card title="Add a member" sub="An existing company user joins this project; a new email creates an account with password demo1234">
            <form action={inviteMemberAction}>
              <input type="hidden" name="projectId" value={projectId} />
              <div className="form-grid">
                <Field label="Email" span>
                  <input className="input" type="email" name="email" placeholder="analyst@yourcompany.com" required />
                </Field>
                <Field label="Name">
                  <input className="input" name="name" placeholder="Optional" />
                </Field>
                <Field label="Project role">
                  <select className="select" name="role" defaultValue="employee">
                    <option value="employee">Employee — grants decide access</option>
                    <option value="reviewer">Reviewer — read-only everywhere</option>
                    <option value="company_admin">Company Admin — full access</option>
                  </select>
                </Field>
              </div>
              <div className="row end" style={{ marginTop: 12 }}>
                <button className="btn btn-primary btn-sm" type="submit">
                  Add to project
                </button>
              </div>
            </form>
            <div className="alert alert-info" style={{ marginTop: 12 }}>
              New accounts are created with the shared demo password and no module grants. Set their grants in
              the table above after adding them.
            </div>
          </Card>

          <Card title="Roles in this project" sub="What each role can do regardless of grants">
            <dl className="kv">
              {ROLES.filter((role) => role.key !== "super_admin").map((role) => (
                <div key={role.key} style={{ display: "contents" }}>
                  <dt>{role.name}</dt>
                  <dd className="small muted">{role.hint}</dd>
                </div>
              ))}
            </dl>
            <p className="tiny muted" style={{ marginTop: 10 }}>
              At least one company admin must remain on a project.
            </p>
          </Card>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <Card title="Project change history" sub="The last 60 attributable events on this project" body="tight">
          {events.length === 0 ? (
            <Empty title="No events yet" />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Entity</th>
                    <th>Action</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td className="small muted nowrap" title={event.at}>
                        {relative(event.at)}
                      </td>
                      <td className="small">{event.actor_name ?? "system"}</td>
                      <td>
                        <span className="chip">{event.entity}</span>
                      </td>
                      <td>
                        <Badge tone={event.action === "delete" ? "danger" : event.action === "create" ? "ok" : "neutral"}>
                          {event.action}
                        </Badge>
                      </td>
                      <td className="small">{event.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {admin ? (
        <div style={{ marginTop: 16 }}>
          <Card title="Danger zone" sub="Project-wide actions">
            <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div className="strong small">Archive instead of delete</div>
                <p className="tiny muted">
                  There is no hard delete in the UI. Archiving keeps the evidence intact; a record that can be
                  erased on a whim is not evidence. Use the button in the Archive card above.
                </p>
              </div>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div className="strong small">Re-license before archiving</div>
                <p className="tiny muted">
                  Turning modules off does not delete their rows. Re-enable the bundle and the data is exactly
                  where you left it.
                </p>
              </div>
            </div>
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <Link className="btn btn-sm" href={`/reports`}>
                Download a report
              </Link>
              <Link className="btn btn-sm" href={`/import`}>
                Import history
              </Link>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}