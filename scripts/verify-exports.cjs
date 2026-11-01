// Temporary smoke check: fetch the real download endpoints with a signed session
// cookie and verify the returned workbooks parse with the expected sheets.
const { createHmac } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const XLSX = require("xlsx");

const BASE = process.env.BASE || "http://localhost:3100";
const SECRET = process.env.SESSION_SECRET || "relialedger-local-development-secret";
const userId = process.env.USER_ID || "u-maya";
const outDir = path.join(os.tmpdir(), "relialedger-verify");
fs.mkdirSync(outDir, { recursive: true });

function cookie() {
  const payload = `${userId}.${Date.now()}`;
  const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `relia_session=${Buffer.from(payload).toString("base64url")}.${sig}`;
}

async function grab(name, url) {
  const res = await fetch(BASE + url, { headers: { cookie: cookie() } });
  const buffer = Buffer.from(await res.arrayBuffer());
  const file = path.join(outDir, name);
  fs.writeFileSync(file, buffer);
  let sheets = [];
  let first = [];
  let error = null;
  try {
    const wb = XLSX.read(buffer, { type: "buffer" });
    sheets = wb.SheetNames;
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheets[sheets.length - 1]], { header: 1, blankrows: false });
    first = (data[0] || []).slice(0, 6);
  } catch (e) {
    error = String(e && e.message);
  }
  return {
    name,
    status: res.status,
    type: (res.headers.get("content-type") || "").split(";")[0],
    disposition: res.headers.get("content-disposition"),
    bytes: buffer.length,
    sheets,
    lastSheetHeader: first,
    error,
  };
}

(async () => {
  const reports = require("node:sqlite");
  const db = new reports.DatabaseSync(path.join(process.cwd(), "data", "relialedger.db"));
  const report = db.prepare("SELECT id FROM reports ORDER BY generated_at DESC LIMIT 1").get();
  db.close();
  if (!report) throw new Error("no reports in the database");

  const results = [];
  results.push(await grab("report.xlsx", `/api/reports/${report.id}/download`));
  results.push(await grab("spares.xlsx", "/api/export/spares?projectId=prj-kestrel"));
  results.push(await grab("template.xlsx", "/api/import/template"));
  results.push({
    name: "unauthorised report",
    ...(await (async () => {
      const res = await fetch(`${BASE}/api/reports/${report.id}/download`);
      return { status: res.status, bytes: (await res.text()).length };
    })()),
  });
  console.log(JSON.stringify({ outDir, results }, null, 2));
})();
