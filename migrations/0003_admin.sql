-- Migración 0003: administradores, sesiones, historial editorial.
-- No se siembran usuarios ni contraseñas. El primer administrador se crea con `npm run admin:create`.

CREATE TABLE admins (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name    TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
  password_hash   TEXT NOT NULL,                          -- PBKDF2-SHA256: 'pbkdf2$<iteraciones>$<salt b64>$<hash b64>'
  active          INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  last_login_at   TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE admin_sessions (
  token_hash  TEXT PRIMARY KEY,                           -- SHA-256 del token; el token en claro solo existe en la cookie HttpOnly
  admin_id    INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX idx_sessions_admin ON admin_sessions (admin_id);

CREATE TABLE editorial_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  admin_id    INTEGER,                                    -- NULL = acción automática del sistema
  actor_label TEXT NOT NULL DEFAULT 'sistema',
  before_json TEXT,
  after_json  TEXT,
  note        TEXT,
  at          TEXT NOT NULL
);
CREATE INDEX idx_history_entity ON editorial_history (entity_type, entity_id, at DESC);
