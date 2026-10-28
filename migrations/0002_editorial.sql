-- Migración 0002: alertas, obituarios, eventos, lugares e instituciones.

CREATE TABLE alerts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id         INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('agua','energia','calles','meteorologica','comunicado')),
  severity        TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','urgente')),
  priority        INTEGER NOT NULL DEFAULT 0,             -- 0 normal … 3 máxima
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  source_url      TEXT,
  starts_at       TEXT NOT NULL,
  expires_at      TEXT,
  -- proposed: detectada, sin publicar · confirmed: publicada · dismissed: descartada · expired
  confirmation    TEXT NOT NULL DEFAULT 'proposed' CHECK (confirmation IN ('proposed','confirmed','dismissed')),
  confirmed_by    INTEGER,
  confirmed_at    TEXT,
  proposed_reason TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_alerts_active ON alerts (confirmation, expires_at);

CREATE TABLE obituaries (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id          INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,                         -- sugerido por el sistema, SIEMPRE corregible por una persona
  death_date       TEXT,                                  -- AAAA-MM-DD, la carga una persona
  message          TEXT,
  service_info     TEXT,
  source_url       TEXT,
  -- pending: cola de revisión · approved: publicado · rejected · retracted: retirado luego de publicado
  state            TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','retracted')),
  approved_by      INTEGER,
  approved_at      TEXT,
  rectification    TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_obituaries_state ON obituaries (state, approved_at DESC);

CREATE TABLE places (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL DEFAULT 'lugar' CHECK (kind IN ('lugar','institucion','servicio')),
  name        TEXT NOT NULL,
  address     TEXT,
  phone       TEXT,
  hours       TEXT,
  url         TEXT,
  notes       TEXT,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  description TEXT,
  starts_at   TEXT NOT NULL,
  ends_at     TEXT,
  place_id    INTEGER REFERENCES places(id) ON DELETE SET NULL,
  place_text  TEXT,
  category    TEXT NOT NULL DEFAULT 'evento' CHECK (category IN ('evento','festividad','actividad')),
  source_label TEXT NOT NULL DEFAULT 'Comuna de Río Seco',
  source_url  TEXT NOT NULL,
  published   INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_events_start ON events (published, starts_at);

-- Referencia pública editable desde el panel (reemplaza a los JSON locales en producción).
CREATE TABLE radios (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  frequency TEXT NOT NULL,
  site_url  TEXT NOT NULL,
  tagline   TEXT,
  active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE bus_localities (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'sin-datos' CHECK (status IN ('sin-datos','verificado')),
  reference_url TEXT
);
CREATE TABLE bus_companies (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE bus_stops (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  locality_id TEXT NOT NULL
);
CREATE TABLE bus_services (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES bus_companies(id),
  locality_id         TEXT NOT NULL REFERENCES bus_localities(id),
  direction           TEXT NOT NULL CHECK (direction IN ('from-rio-seco','to-rio-seco')),
  origin_stop_id      TEXT NOT NULL,
  destination_stop_id TEXT NOT NULL,
  departure           TEXT NOT NULL,
  arrival             TEXT,
  service_type        TEXT NOT NULL DEFAULT 'común',
  day_types           TEXT NOT NULL,                      -- JSON: ["weekday","saturday",…]
  precision           TEXT NOT NULL CHECK (precision IN ('confirmed','approximate')),
  source_label        TEXT NOT NULL,
  source_url          TEXT NOT NULL,
  reuse_authorized    INTEGER NOT NULL CHECK (reuse_authorized = 1),  -- no se admiten horarios sin autorización de reutilización
  last_verified       TEXT NOT NULL,
  valid_from          TEXT,
  valid_to            TEXT,
  exceptions_json     TEXT NOT NULL DEFAULT '[]'
);
