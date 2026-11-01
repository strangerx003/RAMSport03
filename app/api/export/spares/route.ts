import { getDb } from "@/lib/db";
import { sparesRows } from "@/lib/repo";
import { buildSparesWorkbook } from "@/lib/xlsx";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
  const db = getDb();
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (!project || project.company_id !== user.company_id) {
    return new Response("Project not found", { status: 404 });
  }

  const rows = sparesRows(db, projectId);
  const buffer = buildSparesWorkbook(project, rows);
  const slug = String(project.name || "project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${slug || "project"}-spares-rev${project.rev}.xlsx"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
