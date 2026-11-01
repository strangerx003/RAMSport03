import Link from "next/link";
import { redirect } from "next/navigation";
import { createProjectAction, signOutAction } from "@/lib/actions";
import { BUNDLES } from "@/lib/constants";
import { getDb } from "@/lib/db";
import { listProjects } from "@/lib/repo";
import { requireUser } from "@/lib/session";
import { Badge, Card, Empty, Field, Kpi, Notice, PageHead } from "@/components/ui";
import { fmtInt } from "@/lib/format";

export const metadata = { title: "Projects" };

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await requireUser();
  const db = getDb();
  const projects = listProjects(db, user);

  const totalComponents = projects.reduce((sum, p) => sum + (p.component_count ?? 0), 0);
  const totalHazards = projects.reduce((sum, p) => sum + (p.open_hazards ?? 0), 0);
  const active = projects.filter((p) => p.status === "active").length;

  return (
    <div className="main">
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand" style={{ padding: 0, border: 0 }}>
            <div className="brand-mark">R</div>
            <div>
              <div className="brand-name" style={{ color: "var(--ink)" }}>
                RAMSport03
              </div>
              <div className="brand-sub" style={{ color: "var(--muted)" }}>
                {user.company_name ?? "Workspace"}
              </div>
            </div>
          </div>
        </div>
        <div className="topbar-right">
          <span className="badge badge-info">{user.role.replace("_", " ")}</span>
          <span className="small muted">{user.name || user.email}</span>
          <form action={signOutAction}>
            <button className="btn btn-sm btn-ghost" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="content">
        <PageHead
          eyebrow="Workspace"
          title="Projects"
          desc="Each project is one product, one licence and one audit trail. Open a project to work through the nine linked modules."
        >
          <a className="btn" href="#new-project">
            New project
          </a>
        </PageHead>

        <div className="grid cols-4" style={{ marginBottom: 20 }}>
          <Kpi label="Active projects" value={fmtInt(active)} foot={`${projects.length} total`} />
          <Kpi label="Components under analysis" value={fmtInt(totalComponents)} foot="Across every project" />
          <Kpi
            label="Unacceptable hazards"
            value={fmtInt(totalHazards)}
            tone={totalHazards > 0 ? "danger" : "ok"}
            foot="Residual risk still in the red"
          />
          <Kpi label="Your role" value={<span style={{ fontSize: 16 }}>{user.role.replace("_", " ")}</span>} foot={user.company_name} />
        </div>

        {projects.length === 0 ? (
          <Card title="No projects yet" sub="Create your first project below, then add a PBS and failure rates.">
            <Empty title="Nothing to open">
              A project holds the PBS, failure rates and every downstream analysis.
            </Empty>
          </Card>
        ) : (
          <div className="proj-grid">
            {projects.map((project) => {
              const bundle = BUNDLES.find((b) => b.key === project.licensed_bundle);
              return (
                <Link href={`/w/${project.id}/pbs`} className="proj-card" key={project.id}>
                  <div className="row" style={{ gap: 8 }}>
                    <h3>{project.name}</h3>
                    {project.status === "archived" ? <Badge tone="neutral">archived</Badge> : null}
                    <span className="spacer" />
                    <span className="badge badge-neutral">rev {project.rev}</span>
                  </div>
                  <div className="mono tiny muted">
                    {project.code || "no code"} {project.customer ? `· ${project.customer}` : ""}
                  </div>
                  <div className="proj-meta">
                    <span>
                      <b>{fmtInt(project.component_count)}</b> components
                    </span>
                    <span>
                      <b>{fmtInt(project.fmeca_count)}</b> FMECA rows
                    </span>
                    <span>
                      <b>{fmtInt(project.open_hazards)}</b> red hazards
                    </span>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="badge badge-tier">{bundle ? `${bundle.count} modules` : project.licensed_bundle}</span>
                    <span className="tiny muted">{bundle?.name ?? project.licensed_bundle}</span>
                    <span className="spacer" />
                    <span className="tiny muted">lead {project.lead_name ?? "—"}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <div id="new-project" style={{ marginTop: 28, scrollMarginTop: 80 }}>
          <Card
            title="New project"
            sub="You become the Company Admin. The licence bundle can be changed later in project settings."
          >
            <Notice tone="info">
              A project starts with a system-level PBS root. Add subsystems, assemblies and components
              in <strong>PBS</strong>, then give each component one failure rate in <strong>Data Register</strong>.
            </Notice>
            <form action={createProjectAction} style={{ marginTop: 14 }}>
              <div className="form-grid three">
                <Field label="Project name" span>
                  <input className="input" name="name" placeholder="e.g. Kestrel-9 Flight Control" required />
                </Field>
                <Field label="Project code">
                  <input className="input" name="code" placeholder="K9-FCS" />
                </Field>
                <Field label="Customer">
                  <input className="input" name="customer" placeholder="Northwind Aerospace" />
                </Field>
                <Field label="Timezone">
                  <input className="input" name="timezone" defaultValue="UTC" />
                </Field>
                <Field label="Licence bundle">
                  <select className="select" name="bundle" defaultValue="full_suite">
                    {BUNDLES.map((bundle) => (
                      <option value={bundle.key} key={bundle.key}>
                        {bundle.name} — {bundle.count} modules
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Mission length (h)" hint="One flight, run or sortie">
                  <input className="input num" name="mission_hours" type="number" step="1" min="1" defaultValue={8760} />
                </Field>
                <Field label="Operating hours / year">
                  <input className="input num" name="operating_hours" type="number" step="1" min="1" defaultValue={8760} />
                </Field>
                <Field label="Product life (years)">
                  <input className="input num" name="product_life_years" type="number" step="0.5" min="0.5" defaultValue={10} />
                </Field>
              </div>
              <div className="row end" style={{ marginTop: 14 }}>
                <button className="btn btn-primary" type="submit">
                  Create project
                </button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
