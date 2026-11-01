import Link from "next/link";
import { Badge, PageHead } from "@/components/ui";
import DiagramWorkbenchClient from "@/components/workspace/DiagramWorkbenchClient";
import { requireActiveProject } from "@/lib/session";
import { readWorkspace, workspaceComponents, workspaceMeta } from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

export const metadata = { title: "Fault Tree" };

export default async function FtaPage() {
  const ctx = await requireActiveProject();
  const projectId = ctx.project.id;
  ctx.requireRead("fta");
  const grants = ctx.access("fta");

  const components = workspaceComponents(ctx.db, projectId);
  const meta = workspaceMeta(ctx.db, projectId, "fta", Number(ctx.project.mission_hours) || 8760);
  const state = readWorkspace(ctx.db, projectId, "fta", components, meta.missionHours);

  return (
    <>
      <PageHead
        eyebrow="07 · Fault Tree Analysis"
        title={meta.title}
        desc="Drag events and logic gates onto the canvas, connect causes upward into their effect and calculate the top-event probability for the current mission time."
        formula="IEC 61025 · Q(t) = 1 − e^(−λt) · AND: Q = ΠQi · OR: Q = 1 − Π(1 − Qi)"
      >
        <Badge tone={grants.write ? "ok" : "neutral"}>{grants.write ? "Editable" : "Read only"}</Badge>


        <Link className="btn btn-ghost btn-sm" href="/safety">
          Hazards
        </Link>


      </PageHead>

      <DiagramWorkbenchClient
        projectId={projectId}
        mode="fta"
        title={meta.title}
        missionHours={meta.missionHours}
        components={components}
        initialState={state}
        canWrite={grants.write}
      />
    </>
  );
}
