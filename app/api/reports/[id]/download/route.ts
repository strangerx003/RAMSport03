import { getDb } from "@/lib/db";
import { buildReportWorkbook } from "@/lib/xlsx";
import { getSessionUser } from "@/lib/session";
import type { Snapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const db = getDb();
  const report = db
    .prepare(
      `SELECT r.*, p.name AS project_name, p.company_id, v.snapshot
         FROM reports r
         JOIN projects p ON p.id = r.project_id
         LEFT JOIN analysis_versions v ON v.id = r.version_id
        WHERE r.id = ?`,
    )
    .get(id) as any;

  if (!report || report.company_id !== user.company_id) {
    return new Response("Report not found", { status: 404 });
  }
  if (!report.snapshot) {
    return new Response("This report has no stored snapshot.", { status: 410 });
  }

  let snapshot: Snapshot;
  try {
    snapshot = JSON.parse(report.snapshot);
  } catch {
    return new Response("The stored snapshot could not be read.", { status: 500 });
  }

  const buffer = buildReportWorkbook(snapshot);
  const fileName = report.file_name ?? `${report.id}.xlsx`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName.replace(/["\\]/g, "")}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
