-- Río Seco Conecta · Migración 0001: fuentes, categorías y publicaciones.
-- Fechas en ISO-8601 UTC (TEXT). Booleanos como INTEGER 0/1.

CREATE TABLE sources (
  id                    TEXT PRIMARY KEY,                 -- 'facebook-comuna', 'instagram-comuna', 'manual'
  kind                  TEXT NOT NULL CHECK (kind IN ('facebook','instagram','manual')),
  name                  TEXT NOT NULL,
  url                   TEXT,
  mode                  TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('api','assisted','manual')),
  enabled               INTEGER NOT NULL DEFAULT 0,
  trusted               INTEGER NOT NULL DEFAULT 1,       -- fuente oficial: sus publicaciones se aceptan sin revisión previa
  config_json           TEXT NOT NULL DEFAULT '{}',       -- SOLO configuración no secreta (ids, versión de API). Los tokens viven en secretos del Worker.
  poll_interval_seconds INTEGER NOT NULL DEFAULT 60,
  cursor                TEXT,                             -- consulta incremental: último created_time visto
  status                TEXT NOT NULL DEFAULT 'not-configured'
                        CHECK (status IN ('not-configured','ok','rate-limited','auth-error','permission-missing','error','disabled')),
  last_checked_at       TEXT,
  last_success_at       TEXT,
  last_error            TEXT,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  next_attempt_at       TEXT
);

CREATE TABLE categories (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE posts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id        TEXT NOT NULL REFERENCES sources(id),
  external_id      TEXT NOT NULL,                         -- id estable en la plataforma de origen (o 'manual:<uuid>')
  url              TEXT,                                  -- enlace a la publicación original
  title            TEXT NOT NULL,
  body             TEXT NOT NULL DEFAULT '',
  media_json       TEXT NOT NULL DEFAULT '[]',
  published_at     TEXT NOT NULL,
  imported_at      TEXT NOT NULL,
  origin           TEXT NOT NULL CHECK (origin IN ('api','assisted','manual')),
  content_hash     TEXT NOT NULL,
  -- pending: oculta, en cola · published: visible en el feed · rejected · deleted (retirada)
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected','deleted')),
  -- unreviewed: aceptada automáticamente · needs_review: confianza baja o dudosa · approved/rejected: decisión editorial
  review_state     TEXT NOT NULL DEFAULT 'unreviewed' CHECK (review_state IN ('unreviewed','needs_review','approved','rejected')),
  classifier       TEXT,                                  -- nombre/versión del clasificador que propuso las categorías
  rectified_at     TEXT,
  rectification    TEXT,                                  -- nota pública de rectificación
  deleted_at       TEXT,
  created_by       INTEGER,
  UNIQUE (source_id, external_id)
);
CREATE INDEX idx_posts_feed ON posts (status, published_at DESC);
CREATE INDEX idx_posts_hash ON posts (content_hash);
CREATE INDEX idx_posts_review ON posts (review_state, status);

CREATE TABLE post_categories (
  post_id      INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  category_id  TEXT NOT NULL REFERENCES categories(id),
  confidence   REAL NOT NULL DEFAULT 0,                   -- 0..1 propuesta por el clasificador
  proposed_by  TEXT NOT NULL DEFAULT 'rules',             -- 'rules' | 'editor'
  confirmed    INTEGER NOT NULL DEFAULT 0,                -- 1 si un editor la validó o la asignó
  reasons_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (post_id, category_id)
);
CREATE INDEX idx_post_categories_cat ON post_categories (category_id, post_id);
