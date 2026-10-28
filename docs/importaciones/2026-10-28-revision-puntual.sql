-- Revisión puntual del 28/10/2026 de la página pública de la Comuna (ver docs/FACEBOOK.md, sección 5).
-- Tarjetas «solo enlace»: 3 publicaciones que un visitante SIN sesión puede identificar en la última semana.
--  · Sin texto accesible, sin categorías (no se clasifica por miniatura ni por URL), sin alertas ni obituarios.
--  · Fecha NO verificada (Facebook solo mostró «hace 2 horas» / «hace 5 días»): published_at = momento del registro, date_verified = 0.
--  · No notifican (link_only = 1). Se ejecutó una sola vez contra producción, después de respaldar D1 y aplicar la migración 0008.
-- Es idempotente: INSERT OR IGNORE sobre UNIQUE (source_id, external_id).

INSERT OR IGNORE INTO posts (source_id, external_id, url, title, body, media_json, published_at, imported_at, origin, content_hash, status, review_state, link_only, date_verified, historical, content_type)
VALUES
  ('facebook-comuna', '986540003855732', 'https://www.facebook.com/reel/986540003855732/', 'Reel de la Comuna de Río Seco (1:17)', '', '[]',
   strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'assisted', '3875aea322d2c3c5604706476363a630ecdc463f93cb82679a5d9a22a67bac58', 'published', 'unreviewed', 1, 0, 0, 'reel'),
  ('facebook-comuna', 'pfbid02NwcTTeDXFto3dWtpkCUTcmkJTiXSiF32qLsPhFMgEyxSaZoECjY4cK1PuJ33gqJ7l', 'https://www.facebook.com/permalink.php?story_fbid=pfbid02NwcTTeDXFto3dWtpkCUTcmkJTiXSiF32qLsPhFMgEyxSaZoECjY4cK1PuJ33gqJ7l&id=61553018412844', 'Video de la Comuna de Río Seco (1:06)', '', '[]',
   strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'assisted', '94e83f5c4c1573dee31425ece4a7208e6db9d5d85917e0e9eb7fbf92caec9734', 'published', 'unreviewed', 1, 0, 0, 'video'),
  ('facebook-comuna', '1104454118855678', 'https://www.facebook.com/reel/1104454118855678/', 'Reel de la Comuna de Río Seco (1:38)', '', '[]',
   strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'assisted', 'd5776d07468dd2af8ece18011b73f1388140b7c0d52ec6c93071c8cb52c9309a', 'published', 'unreviewed', 1, 0, 0, 'reel');

INSERT INTO editorial_history (entity_type, entity_id, action, admin_id, actor_label, after_json, note, at)
SELECT 'post', CAST(id AS TEXT), 'registered-link', NULL, 'revisión puntual (agente)', '{"status":"published","categories":[],"dateVerified":false}',
       'Tarjeta creada solo con el enlace tras revisar la página pública el 28/10/2026 (sin texto accesible ni fecha absoluta)', strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM posts
WHERE source_id = 'facebook-comuna' AND link_only = 1
  AND external_id IN ('986540003855732', 'pfbid02NwcTTeDXFto3dWtpkCUTcmkJTiXSiF32qLsPhFMgEyxSaZoECjY4cK1PuJ33gqJ7l', '1104454118855678')
  AND NOT EXISTS (SELECT 1 FROM editorial_history h WHERE h.entity_type = 'post' AND h.entity_id = CAST(posts.id AS TEXT) AND h.action = 'registered-link');
