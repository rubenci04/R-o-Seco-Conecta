-- Migración 0004: sincronización, notificaciones y suscripciones Web Push.

CREATE TABLE sync_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id    TEXT NOT NULL REFERENCES sources(id),
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  outcome      TEXT NOT NULL CHECK (outcome IN ('success','rate-limited','auth-error','permission-missing','error','skipped')),
  fetched      INTEGER NOT NULL DEFAULT 0,
  inserted     INTEGER NOT NULL DEFAULT 0,
  duplicates   INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  retry_after  TEXT
);
CREATE INDEX idx_sync_runs_source ON sync_runs (source_id, started_at DESC);

CREATE TABLE push_subscriptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint      TEXT NOT NULL UNIQUE,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  topics_json   TEXT NOT NULL DEFAULT '[]',               -- ids de categoría + 'urgente'
  active        INTEGER NOT NULL DEFAULT 1,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_success_at TEXT
);

CREATE TABLE notification_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key    TEXT NOT NULL UNIQUE,                     -- 'post:12' | 'alert:4': impide notificar dos veces lo mismo
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('post','alert','obituary')),
  entity_id     INTEGER NOT NULL,
  topics_json   TEXT NOT NULL,
  urgent        INTEGER NOT NULL DEFAULT 0,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  url           TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','done','suppressed')),
  suppressed_reason TEXT,
  cursor_id     INTEGER NOT NULL DEFAULT 0,               -- última suscripción procesada (envío por lotes)
  attempted     INTEGER NOT NULL DEFAULT 0,
  succeeded     INTEGER NOT NULL DEFAULT 0,
  failed        INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TEXT NOT NULL,
  finished_at   TEXT
);
CREATE INDEX idx_notification_state ON notification_log (state, id);
