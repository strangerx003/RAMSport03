# RAMSport03

**Reliability analysis that can prove itself.**

RAMSport03 is a clean-room, web-based RAMS analysis workspace for reliability engineers and
consultants. Nine linked modules share one data model, so a failure rate entered once propagates
into criticality, hazards, cut sets, spares, maintenance and the report pack — and every derived
number keeps a record of the revision it was computed from.

Built from public descriptions of what reliability teams need, not from anyone else's source code,
assets, copy or brand.

---

## Quick start

Requires **Node.js 22.5 or newer** (the app uses the built-in `node:sqlite` module — no Docker, no
external database, no native build step).

```powershell
npm install
npm run dev
```

Open <http://localhost:3000>.

The database is created and seeded on first request at `data/relialedger.db`. Delete the `data/`
folder to start from a clean seed.

### Demo accounts

Password for the three seeded demo accounts: `demo1234`

| Email | Name | Role | What to try |
| --- | --- | --- | --- |
| `admin@relialedger.app` | Maya Iyer | Company admin | Everything: edit, re-license, manage members, generate reports |
| `analyst@relialedger.app` | Priya Raman | Employee | Write on PBS and FMECA; read elsewhere |
| `reviewer@relialedger.app` | Tom Beckett | Reviewer | Read-only everywhere, including downloads |
| `username-test` | Test User | Tester (company admin on seeded projects) | Quick access to every module |

The testing account uses `username-test` / `password-test`. It is created idempotently and given a
project membership so the login works on both fresh and existing databases.

Seeded project: **Kestrel-9 Flight Control**, company *Northwind Aerospace*.

### Scripts

```powershell
npm run dev        # dev server (Turbopack)
npm run build      # production build
npm run start      # serve the production build
npm run typecheck  # tsc --noEmit
```

With the dev server running, `node scripts/verify-exports.cjs` fetches the report pack, spares export
and import template over HTTP with a signed session cookie, then checks that each one parses as a
workbook with the expected sheets.

---

## The nine modules

| # | Module | What it owns | Core maths |
| --- | --- | --- | --- |
| 01 | PBS | Hierarchy, part numbers, quantities | quantity-weighted λ roll-up |
| 02 | Data Register | One editable component spreadsheet with λ, MTTR and derived metrics | MTBF = 1/λ, A = 1/(1 + λ·MTTR), FIT = λ × 10⁹ |
| 03 | FMECA | Failure modes and criticality ranking | MIL-STD-1629A: Cm = β·α·λ·t |
| 04 | PM | Maintenance tasks and intervals | next due = last done + interval |
| 05 | Spares | Demand, reorder point, recommended buy | Poisson lead-time demand at target service level |
| 06 | Safety | Hazard register, residual risk, ALARP | risk = severity × likelihood |
| 07 | FTA | Fault tree, minimal cut sets | IEC 61025 gate probability + MOCUS cut sets |
| 08 | RBD | Series / parallel / k-of-n blocks | Rsys = Π stage reliability |
| 09 | Reports | Frozen snapshot packs | report = snapshot(revision, modules) |

Supporting screens: **Import** (Excel/CSV hierarchy import with a downloadable template) and
**Settings** (project inputs, licence bundle, members and grants, audit trail).

## Design decisions worth knowing

**λ is stored once, in failures per hour.** Every screen displays FPMH because that is how
handbooks publish it. There is exactly one rate per component, so register λ, FMECA, FTA, RBD, spares and PM
cannot disagree. Rates are per unit: the PBS, register λ and Data Register totals multiply a component's
rate by its line quantity, while FMECA Cm, FTA basic events and RBD blocks stay per item, because that
is what those methods model. Spares demand does multiply by quantity.

**Live propagation, with provenance.** Saving a rate re-prices FMECA, FTA, RBD and spares in the same
request. Each FMECA row stores the `lambda_used` and the revision it was priced at, so a reviewer can
see which input produced a criticality number even after the live analysis moves on.

**Reports are evidence.** Generating a report writes an immutable snapshot of every selected table
and downloads rebuild the workbook from that snapshot only. Regenerating creates a new pack; it never
silently rewrites an issued one.

**Excel-first output.** Report packs, the spares plan and the import template are real `.xlsx`
workbooks with flat header rows, numeric cells and sensible column widths, so they can be filtered,
pivoted or merged into a customer's own pack without cleaning.

**Concurrency.** SQLite runs in WAL mode with a busy timeout, so concurrent readers do not block each
other and writes queue instead of failing. All writes are server actions; pages are rendered
dynamically per request, so one user's edit is never served stale to the next.

**Access control is enforced server-side.** Roles (company admin, employee, reviewer), per-module
grants and licence bundles are checked in every server action, not just hidden in the UI.

## Handbook data and licensing

MIL-HDBK-217F part-stress formulas, π factors and quality levels are implemented, together with a
small, openly editable subset of part families used by the demo project. The full MIL-HDBK-217F and
NPRD tables are licensed documents, so their data is **not** bundled. If you hold a licensed extract,
shape it as `Name, Lambda` and import it: the method is recorded as `imported` so the provenance
survives review.

## Project layout

```
app/                 routes: login, projects, workspace modules, API downloads
  w/[projectId]/     one folder per module (pbs … reports, import, settings)
components/          shared UI, sidebar, topbar, confirm dialogs, MIL-217F calculator
lib/
  schema.ts          SQLite DDL (21 tables)
  db.ts              bootstrap, migrations, demo seed
  calc.ts            all engineering maths (MIL-217F, FMECA, cut sets, RBD, spares)
  repo.ts            read models used by pages
  actions.ts         server actions (the only write path)
  snapshot.ts        frozen report snapshot
  recompute.ts       re-pricing after an input change
  xlsx.ts            workbook builders
data/                created at runtime, git-ignored (database + WAL files)
```

## Limits

- Single-tenant SQLite deployment: excellent for teams and evaluation, not a multi-region SaaS.
  The read models and write path are separated, so moving to Postgres means replacing `lib/db.ts`
  and the SQL in `lib/repo.ts`/`lib/actions.ts`, not the pages.
- No hard delete anywhere in the UI. Projects archive instead, so the audit trail stays intact.
- Accounts are created by an admin invitation only; there is no self-service signup or email
  delivery in this build.
