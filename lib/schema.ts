export const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'standard',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'employee'
                  CHECK (role IN ('super_admin','company_admin','employee','reviewer')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id                 TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  code               TEXT,
  customer           TEXT,
  timezone           TEXT NOT NULL DEFAULT 'UTC',
  licensed_bundle    TEXT NOT NULL DEFAULT 'full_suite',
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  mission_hours      REAL NOT NULL DEFAULT 8760,
  operating_hours    REAL NOT NULL DEFAULT 8760,
  product_life_years REAL NOT NULL DEFAULT 10,
  rev                INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'employee'
                  CHECK (role IN ('super_admin','company_admin','employee','reviewer')),
  module_grants TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS module_entitlements (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (project_id, module_key)
);

CREATE TABLE IF NOT EXISTS pbs_nodes (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES pbs_nodes(id) ON DELETE CASCADE,
  level       TEXT NOT NULL CHECK (level IN ('system','subsystem','assembly','component')),
  name        TEXT NOT NULL,
  part_number TEXT,
  quantity    REAL NOT NULL DEFAULT 1,
  category    TEXT NOT NULL DEFAULT 'other'
                CHECK (category IN ('electronic','mechanical','software','other')),
  location    TEXT,
  depth       INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS pbs_project ON pbs_nodes(project_id, parent_id, sort_order);

CREATE TABLE IF NOT EXISTS failure_rates (
  pbs_node_id     TEXT PRIMARY KEY REFERENCES pbs_nodes(id) ON DELETE CASCADE,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  method          TEXT NOT NULL DEFAULT 'manual'
                    CHECK (method IN ('manual','mil_217f','nprd','imported')),
  lambda_per_hour REAL NOT NULL DEFAULT 0,
  environment     TEXT,
  quality         TEXT,
  part_type       TEXT,
  factors         TEXT NOT NULL DEFAULT '{}',
  source_ref      TEXT,
  calculated_at   TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS fr_project ON failure_rates(project_id);

CREATE TABLE IF NOT EXISTS mttr_records (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pbs_node_id      TEXT NOT NULL UNIQUE REFERENCES pbs_nodes(id) ON DELETE CASCADE,
  repair_location  TEXT,
  manpower         INTEGER NOT NULL DEFAULT 1,
  spares_available INTEGER NOT NULL DEFAULT 1,
  mttr_hours       REAL,
  version          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS mttr_steps (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mttr_record_id TEXT NOT NULL REFERENCES mttr_records(id) ON DELETE CASCADE,
  phase          TEXT NOT NULL CHECK (phase IN ('detect','diagnose','repair','verify')),
  description    TEXT NOT NULL DEFAULT '',
  minutes        REAL NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fmea_rows (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pbs_node_id   TEXT NOT NULL REFERENCES pbs_nodes(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('dfmea','fmeca')),
  failure_mode  TEXT NOT NULL,
  cause         TEXT,
  local_effect  TEXT,
  system_effect TEXT,
  end_effect    TEXT,
  severity      INTEGER,
  occurrence    INTEGER,
  detection     INTEGER,
  rpn           INTEGER,
  alpha         REAL,
  beta          REAL,
  mission_t     REAL,
  cm            REAL,
  cr_rank       INTEGER,
  lambda_used   REAL,
  priced_rev    INTEGER,
  action        TEXT,
  action_owner  TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS fmea_component ON fmea_rows(pbs_node_id);
CREATE INDEX IF NOT EXISTS fmea_kind ON fmea_rows(project_id, kind, cr_rank);

CREATE TABLE IF NOT EXISTS maintenance_tasks (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pbs_node_id    TEXT NOT NULL REFERENCES pbs_nodes(id) ON DELETE CASCADE,
  fmea_row_id    TEXT REFERENCES fmea_rows(id) ON DELETE SET NULL,
  description    TEXT NOT NULL,
  strategy       TEXT NOT NULL DEFAULT 'time' CHECK (strategy IN ('time','condition')),
  interval_value REAL NOT NULL DEFAULT 90,
  interval_unit  TEXT NOT NULL DEFAULT 'days'
                   CHECK (interval_unit IN ('hours','days','weeks','months','cycles')),
  manpower       INTEGER NOT NULL DEFAULT 1,
  last_done_at   TEXT,
  next_due_at    TEXT,
  version        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS pm_due ON maintenance_tasks(project_id, next_due_at);

CREATE TABLE IF NOT EXISTS spare_items (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pbs_node_id     TEXT NOT NULL UNIQUE REFERENCES pbs_nodes(id) ON DELETE CASCADE,
  qty_on_hand     INTEGER NOT NULL DEFAULT 0,
  recommended_qty INTEGER,
  lead_time_days  INTEGER NOT NULL DEFAULT 30,
  moq             INTEGER NOT NULL DEFAULT 1,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'USD',
  reorder_point   INTEGER,
  safety_stock    INTEGER,
  service_level   REAL NOT NULL DEFAULT 0.95,
  version         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS hazards (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pbs_node_id         TEXT REFERENCES pbs_nodes(id) ON DELETE SET NULL,
  description         TEXT NOT NULL,
  severity            INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 4),
  likelihood          INTEGER NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
  controls            TEXT NOT NULL DEFAULT '[]',
  residual_severity   INTEGER,
  residual_likelihood INTEGER,
  alarp               TEXT NOT NULL DEFAULT 'unacceptable'
                        CHECK (alarp IN ('acceptable','alarp','unacceptable')),
  version             INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fault_trees (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name           TEXT NOT NULL DEFAULT 'Untitled tree',
  top_label      TEXT,
  q_t            REAL,
  mission_hours  REAL NOT NULL DEFAULT 8760,
  computed_at    TEXT,
  truncated      INTEGER NOT NULL DEFAULT 0,
  version        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fault_tree_nodes (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tree_id     TEXT NOT NULL REFERENCES fault_trees(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES fault_tree_nodes(id) ON DELETE CASCADE,
  node_type   TEXT NOT NULL CHECK (node_type IN ('event','gate')),
  gate_type   TEXT CHECK (gate_type IN ('and','or','voting')),
  gate_k      INTEGER,
  pbs_node_id TEXT REFERENCES pbs_nodes(id) ON DELETE SET NULL,
  label       TEXT NOT NULL DEFAULT '',
  probability REAL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS fta_nodes_tree ON fault_tree_nodes(tree_id, parent_id, sort_order);

CREATE TABLE IF NOT EXISTS rbd_models (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT 'Untitled RBD',
  rsys          REAL,
  availability  REAL,
  mission_hours REAL,
  computed_at   TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rbd_blocks (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  model_id    TEXT NOT NULL REFERENCES rbd_models(id) ON DELETE CASCADE,
  pbs_node_id TEXT REFERENCES pbs_nodes(id) ON DELETE SET NULL,
  label       TEXT NOT NULL DEFAULT '',
  reliability REAL NOT NULL DEFAULT 0.99,
  group_key   TEXT NOT NULL DEFAULT 'stage-1',
  group_type  TEXT NOT NULL DEFAULT 'series'
                CHECK (group_type IN ('series','parallel','k_out_of_n')),
  group_k     INTEGER,
  group_n     INTEGER,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS rbd_blocks_model ON rbd_blocks(model_id, sort_order);

/* Free-form RBD / FTA diagram documents drawn in the workspace canvas. */
CREATE TABLE IF NOT EXISTS diagram_workspaces (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mode       TEXT NOT NULL CHECK (mode IN ('rbd','fta')),
  state      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, mode)
);

CREATE TABLE IF NOT EXISTS analysis_versions (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rev        INTEGER NOT NULL,
  label      TEXT,
  snapshot   TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_id   TEXT REFERENCES analysis_versions(id) ON DELETE SET NULL,
  modules      TEXT NOT NULL,
  filters      TEXT NOT NULL DEFAULT '{}',
  format       TEXT NOT NULL DEFAULT 'xlsx',
  status       TEXT NOT NULL DEFAULT 'ready',
  file_name    TEXT,
  revision     INTEGER NOT NULL DEFAULT 1,
  generated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'committed',
  rows_total  INTEGER NOT NULL DEFAULT 0,
  rows_ok     INTEGER NOT NULL DEFAULT 0,
  rows_error  INTEGER NOT NULL DEFAULT 0,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id TEXT,
  actor_id   TEXT,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,
  at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS audit_recent ON audit_events(company_id, at DESC);
`;
