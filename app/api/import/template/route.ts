import { buildImportTemplate } from "@/lib/xlsx";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const buffer = buildImportTemplate();

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="rams-port-03-import-template.xlsx"',
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
