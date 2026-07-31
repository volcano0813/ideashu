import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const SCHEMA_VERSION = 2

const migration2 = `
CREATE TRIGGER draft_revisions_no_update BEFORE UPDATE ON draft_revisions BEGIN SELECT RAISE(ABORT, 'draft revisions are immutable'); END;
CREATE TRIGGER draft_revisions_no_delete BEFORE DELETE ON draft_revisions BEGIN SELECT RAISE(ABORT, 'draft revisions are immutable'); END;
CREATE TRIGGER review_reports_no_update BEFORE UPDATE ON review_reports BEGIN SELECT RAISE(ABORT, 'review reports are immutable'); END;
CREATE TRIGGER review_reports_no_delete BEFORE DELETE ON review_reports BEGIN SELECT RAISE(ABORT, 'review reports are immutable'); END;
CREATE TRIGGER cover_variants_no_update BEFORE UPDATE ON cover_variants BEGIN SELECT RAISE(ABORT, 'cover variants are immutable'); END;
CREATE TRIGGER cover_variants_no_delete BEFORE DELETE ON cover_variants BEGIN SELECT RAISE(ABORT, 'cover variants are immutable'); END;
CREATE TRIGGER publish_packages_no_update BEFORE UPDATE ON publish_packages BEGIN SELECT RAISE(ABORT, 'publish packages are immutable'); END;
CREATE TRIGGER publish_packages_no_delete BEFORE DELETE ON publish_packages BEGIN SELECT RAISE(ABORT, 'publish packages are immutable'); END;
CREATE TRIGGER review_reports_scope_insert BEFORE INSERT ON review_reports
WHEN NOT EXISTS (SELECT 1 FROM draft_revisions d WHERE d.workspace_id = NEW.workspace_id AND d.account_id = NEW.account_id AND d.draft_id = NEW.draft_id AND d.revision = NEW.draft_revision)
BEGIN SELECT RAISE(ABORT, 'review draft scope mismatch'); END;
CREATE TRIGGER cover_variants_scope_insert BEFORE INSERT ON cover_variants
WHEN NOT EXISTS (SELECT 1 FROM draft_revisions d WHERE d.workspace_id = NEW.workspace_id AND d.account_id = NEW.account_id AND d.draft_id = NEW.draft_id AND d.revision = NEW.draft_revision)
BEGIN SELECT RAISE(ABORT, 'cover draft scope mismatch'); END;
CREATE TRIGGER publish_packages_scope_insert BEFORE INSERT ON publish_packages
WHEN NOT EXISTS (
  SELECT 1 FROM draft_revisions d JOIN cover_variants c
    ON c.workspace_id = d.workspace_id AND c.account_id = d.account_id
    AND c.draft_id = d.draft_id AND c.draft_revision = d.revision
  WHERE d.workspace_id = NEW.workspace_id AND d.account_id = NEW.account_id
    AND d.draft_id = NEW.draft_id AND d.revision = NEW.draft_revision AND c.id = NEW.cover_id
)
BEGIN SELECT RAISE(ABORT, 'package draft and cover scope mismatch'); END;
`

const migration = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE operators (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  owner_operator_id TEXT NOT NULL REFERENCES operators(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE content_accounts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT '',
  persona TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT '',
  style_name TEXT NOT NULL DEFAULT '',
  profile_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(profile_json)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(workspace_id, id)
);
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('material_image','cover_background','cover_render','attachment','export')),
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
  sha256 TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id, account_id, id),
  UNIQUE(workspace_id, account_id, sha256),
  FOREIGN KEY(workspace_id, account_id) REFERENCES content_accounts(workspace_id, id)
);
CREATE TABLE materials (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('text','photo','voice','data','link')),
  content TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags_json)),
  artifact_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(workspace_id, account_id, id),
  FOREIGN KEY(workspace_id, account_id) REFERENCES content_accounts(workspace_id, id),
  FOREIGN KEY(workspace_id, account_id, artifact_id) REFERENCES artifacts(workspace_id, account_id, id)
);
CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('collecting','topic_ready','topic_approved','drafting','draft_review','draft_approved','covering','cover_approved','packaged','cancelled')),
  objective TEXT NOT NULL DEFAULT '',
  selected_topic_id TEXT,
  approved_draft_revision INTEGER,
  approved_cover_id TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  UNIQUE(workspace_id, account_id, id),
  FOREIGN KEY(workspace_id, account_id) REFERENCES content_accounts(workspace_id, id)
);
CREATE TABLE topic_candidates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  title TEXT NOT NULL,
  angle TEXT NOT NULL DEFAULT '',
  rationale TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_json)),
  score_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(score_json)),
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id, account_id, id),
  FOREIGN KEY(workspace_id, account_id, workflow_id) REFERENCES workflow_runs(workspace_id, account_id, id)
);
CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, account_id, id),
  UNIQUE(workspace_id, account_id, workflow_id),
  FOREIGN KEY(workspace_id, account_id, workflow_id) REFERENCES workflow_runs(workspace_id, account_id, id)
);
CREATE TABLE draft_revisions (
  draft_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags_json)),
  material_anchors_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(material_anchors_json)),
  change_summary TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(draft_id, revision),
  FOREIGN KEY(workspace_id, account_id, draft_id) REFERENCES drafts(workspace_id, account_id, id)
);
CREATE TABLE review_reports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  draft_revision INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('pass','revise','blocked')),
  scores_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(scores_json)),
  required_changes_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(required_changes_json)),
  optional_suggestions_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(optional_suggestions_json)),
  evidence_gaps_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_gaps_json)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id, account_id, id),
  FOREIGN KEY(draft_id, draft_revision) REFERENCES draft_revisions(draft_id, revision),
  FOREIGN KEY(workspace_id, account_id, workflow_id) REFERENCES workflow_runs(workspace_id, account_id, id)
);
CREATE TABLE cover_variants (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  draft_revision INTEGER NOT NULL,
  brief_json TEXT NOT NULL CHECK(json_valid(brief_json)),
  composition_json TEXT NOT NULL CHECK(json_valid(composition_json)),
  background_artifact_id TEXT,
  rendered_artifact_id TEXT,
  qa_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(qa_json)),
  status TEXT NOT NULL CHECK(status IN ('planned','rendered','qa_passed','qa_failed')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id, account_id, id),
  FOREIGN KEY(draft_id, draft_revision) REFERENCES draft_revisions(draft_id, revision),
  FOREIGN KEY(workspace_id, account_id, workflow_id) REFERENCES workflow_runs(workspace_id, account_id, id),
  FOREIGN KEY(workspace_id, account_id, background_artifact_id) REFERENCES artifacts(workspace_id, account_id, id),
  FOREIGN KEY(workspace_id, account_id, rendered_artifact_id) REFERENCES artifacts(workspace_id, account_id, id)
);
CREATE TABLE publish_packages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  draft_revision INTEGER NOT NULL,
  cover_id TEXT NOT NULL,
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id, account_id, id),
  UNIQUE(workspace_id, account_id, workflow_id),
  FOREIGN KEY(draft_id, draft_revision) REFERENCES draft_revisions(draft_id, revision),
  FOREIGN KEY(workspace_id, account_id, cover_id) REFERENCES cover_variants(workspace_id, account_id, id)
);
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  workflow_id TEXT,
  host TEXT NOT NULL CHECK(host IN ('codex','workbuddy','manual','unknown')),
  skill TEXT,
  status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','cancelled')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_json TEXT CHECK(error_json IS NULL OR json_valid(error_json)),
  UNIQUE(workspace_id, account_id, id),
  FOREIGN KEY(workspace_id, account_id) REFERENCES content_accounts(workspace_id, id),
  FOREIGN KEY(workspace_id, account_id, workflow_id) REFERENCES workflow_runs(workspace_id, account_id, id)
);
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  workflow_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled','needs_reconcile')),
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  input_json TEXT NOT NULL CHECK(json_valid(input_json)),
  output_json TEXT CHECK(output_json IS NULL OR json_valid(output_json)),
  last_error_json TEXT CHECK(last_error_json IS NULL OR json_valid(last_error_json)),
  lease_owner TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, account_id, id),
  FOREIGN KEY(workspace_id, account_id) REFERENCES content_accounts(workspace_id, id)
);
CREATE TABLE idempotency_records (
  workspace_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_sha256 TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, actor_kind, actor_id, operation, idempotency_key)
);
CREATE TABLE audit_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  account_id TEXT,
  workflow_id TEXT,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_revision INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(payload_json)),
  created_at TEXT NOT NULL
);
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END;
CREATE INDEX idx_accounts_workspace ON content_accounts(workspace_id, updated_at);
CREATE INDEX idx_materials_scope ON materials(workspace_id, account_id, updated_at);
CREATE INDEX idx_workflows_scope ON workflow_runs(workspace_id, account_id, updated_at);
CREATE INDEX idx_audit_scope ON audit_events(workspace_id, account_id, sequence);
`

function now() {
  return new Date().toISOString()
}

export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true })
  const db = new DatabaseSync(filename)
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;')
  const fk = db.prepare('PRAGMA foreign_keys').get().foreign_keys
  if (fk !== 1) throw new Error('SQLite foreign keys could not be enabled')
  migrate(db)
  return db
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
  const current = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version
  if (current > SCHEMA_VERSION) throw new Error(`Database schema ${current} is newer than supported ${SCHEMA_VERSION}`)
  if (current === 0) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(migration)
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?)').run(now())
      const operatorId = randomUUID()
      const workspaceId = randomUUID()
      db.prepare('INSERT INTO operators(id, display_name, created_at) VALUES (?, ?, ?)').run(operatorId, 'Local operator', now())
      db.prepare('INSERT INTO workspaces(id, owner_operator_id, name, created_at) VALUES (?, ?, ?, ?)').run(workspaceId, operatorId, 'IdeaShu local workspace', now())
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  const afterInitial = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version
  if (afterInitial < 2) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(migration2)
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (2, ?)').run(now())
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

export function getLocalScope(db) {
  const row = db.prepare('SELECT w.id AS workspace_id, w.owner_operator_id AS operator_id FROM workspaces w ORDER BY w.created_at LIMIT 1').get()
  if (!row) throw new Error('Local workspace is missing')
  return { workspaceId: row.workspace_id, operatorId: row.operator_id }
}
