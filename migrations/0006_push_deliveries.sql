-- Migración 0006 (Sprint 05): Web Push real. Entrega por dispositivo, dispositivos de prueba y límite de solicitudes.
-- No borra ni modifica noticias ni datos existentes.

ALTER TABLE push_subscriptions ADD COLUMN token_hash TEXT;               -- SHA-256 del token de gestión (el token solo lo conoce el dispositivo)
ALTER TABLE push_subscriptions ADD COLUMN service TEXT NOT NULL DEFAULT 'otro';   -- fcm | mozilla | apple | windows
ALTER TABLE push_subscriptions ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;       -- dispositivo de prueba registrado por un administrador
ALTER TABLE push_subscriptions ADD COLUMN label TEXT;                    -- nombre del dispositivo de prueba
ALTER TABLE push_subscriptions ADD COLUMN updated_at TEXT;
ALTER TABLE push_subscriptions ADD COLUMN last_error TEXT;
CREATE INDEX idx_push_active ON push_subscriptions (active, is_test, id);

ALTER TABLE notification_log ADD COLUMN test_subscription_id INTEGER;    -- aviso de prueba dirigido a UN dispositivo
ALTER TABLE notification_log ADD COLUMN fanout_done INTEGER NOT NULL DEFAULT 0;

-- Una fila por (aviso, dispositivo): permite reintentos, resultado individual y que ningún dispositivo reciba dos veces el mismo aviso.
CREATE TABLE notification_deliveries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id INTEGER NOT NULL REFERENCES notification_log(id) ON DELETE CASCADE,
  subscription_id INTEGER NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  state           TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sent','failed','gone')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_status     INTEGER,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  sent_at         TEXT,
  UNIQUE (notification_id, subscription_id)
);
CREATE INDEX idx_deliveries_due ON notification_deliveries (state, next_attempt_at);
CREATE INDEX idx_deliveries_notification ON notification_deliveries (notification_id, state);

-- Límite de solicitudes por ventana (clave = hash del origen + acción; sin guardar IP en claro).
CREATE TABLE rate_limits (
  key          TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
