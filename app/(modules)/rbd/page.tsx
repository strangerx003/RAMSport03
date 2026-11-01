import Link from "next/link";
import { Badge, PageHead } from "@/components/ui";
import DiagramWorkbenchClient from "@/components/workspace/DiagramWorkbenchClient";
import { requireActiveProject } from "@/lib/session";
import { readWorkspace, workspaceComponents, workspaceMeta } from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

export const metadata = { title: "RBD" };

export default async function RbdPage() {
  const ctx = await requireActiveProject();
  const projectId = ctx.project.id;
  ctx.requireRead("rbd");
  const grants = ctx.access("rbd");

  const components = workspaceComponents(ctx.db, projectId);
  const meta = workspaceMeta(ctx.db, projectId, "rbd", Number(ctx.project.mission_hours) || 8760);
  const state = readWorkspace(ctx.db, projectId, "rbd", components, meta.missionHours);

  return (
    <>
      <PageHead
        eyebrow="08 · Reliability Block Diagram"
        title={meta.title}
        desc="Drag blocks from the PBS component library onto the canvas, connect them in the required flow and calculate the equivalent system reliability, availability and MTBF."
        formula="IEC 61078 · λs = Σλi · MTTRs = Σ(λi × MTTRi) / λs · MTBFs = 1 / λs"
      >
        <Badge tone={grants.write ? "ok" : "neutral"}>{grants.write ? "Editable" : "Read only"}</Badge>



      </PageHead>

      <DiagramWorkbenchClient
        projectId={projectId}
        mode="rbd"
        title={meta.title}
        missionHours={meta.missionHours}
        components={components}
        initialState={state}
        canWrite={grants.write}
      />
    </>
  );
}