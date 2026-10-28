-- Migración 0007 (Sprint 06): categoría «Recolección de residuos y limpieza urbana». Aditiva: no modifica ni borra datos existentes.
-- Las preferencias de notificación ya guardadas (topics_json) no se tocan: nadie queda suscripto a «residuos» sin elegirlo.
INSERT OR IGNORE INTO categories (id, name, description, sort_order) VALUES
  ('residuos', 'Recolección de residuos y limpieza urbana', 'Días de recolección, suspensiones, reprogramaciones y campañas de limpieza', 13);
