import Link from "next/link";
import DataRegister from "@/components/register/DataRegister";
import { Badge, Notice, PageHead } from "@/components/ui";
import { dataRegisterParents, dataRegisterRows, registerMetrics } from "@/lib/data-register";
import { fmtInt, fmtLambda, pct } from "@/lib/format";
import { requireActiveProject } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = { title: "Data Register" };

export default async function RegisterPage() {
  const ctx = await requireActiveProject();
  const projectId = ctx.project.id;
  ctx.requireRead("register");
  const grants = ctx.access("register");

  const rows = dataRegisterRows(ctx.db, projectId);
  const parents = dataRegisterParents(ctx.db, projectId);
  const missionHours = Number(ctx.project.mission_hours) || 8760;
  const missingWrite = (["pbs"] as const).filter((module) => !ctx.access(module).write);
  const canWrite = grants.write && missingWrite.length === 0;

  const rated = rows.filter((row) => row.lambda > 0).length;
  const missingMttr = rows.filter((row) => !(row.mttr > 0)).length;
  const totalLambda = rows.reduce((sum, row) => sum + row.lambda * Math.max(1, row.qty), 0);
  const meanAvailability = rows.length
    ? rows.reduce((sum, row) => sum + registerMetrics(row, missionHours).availability, 0) / rows.length
    : 1;

  return (
    <>
      <PageHead
        eyebrow="02 · Data Register"
        title="Component data register"
        desc="The spreadsheet view of every PBS component line: identity, quantity, failure rate, repair time and the derived metrics. A save writes PBS, λ values and MTTR together, so the register and the analysis can never drift apart."
        formula="MTBF = 1/λ · A = 1/(1 + λ·MTTR) · FIT = λ × 10⁹ · R(t) = e^(−λt)"
      >
        <Badge tone={canWrite ? "ok" : "neutral"}>{canWrite ? "Editable" : "Read only"}</Badge>
        <Link className="btn btn-ghost btn-sm" href={`/pbs`}>
          PBS hierarchy
        </Link>
      </PageHead>


      {rows.length - rated ? (
        <div style={{ marginTop: 14 }}>
          <Notice tone="warn">
            {rows.length - rated} component line{rows.length - rated === 1 ? "" : "s"} have no failure rate.
            Downstream modules treat them as zero until a λ is entered here.
          </Notice>
        </div>
      ) : null}

      {grants.write && missingWrite.length ? (
        <div style={{ marginTop: 14 }}>
          <Notice tone="warn">
            Register edits write PBS, λ values and MTTR together. You have read-only access to{" "}
            {missingWrite.map((module) => module.toUpperCase()).join(", ")}, so the register is shown read-only.
          </Notice>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <DataRegister
          projectId={projectId}
          rows={rows}
          parents={parents}
          missionHours={missionHours}
          canWrite={canWrite}
        />
      </div>
    </>
  );
}