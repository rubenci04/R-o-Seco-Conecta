-- Migración 0008: tarjetas individuales por enlace (publicaciones externas sin texto original) y cargas históricas.
-- Aditiva: las publicaciones existentes conservan su comportamiento (con texto, fecha verificada, no históricas).

-- 1 = tarjeta creada solo con el enlace: no hay texto original, no se analizó automáticamente y no genera alertas ni obituarios.
ALTER TABLE posts ADD COLUMN link_only INTEGER NOT NULL DEFAULT 0;
-- 0 = published_at es la fecha de REGISTRO (no se conoce la fecha original). Nunca se muestra como fecha de publicación.
ALTER TABLE posts ADD COLUMN date_verified INTEGER NOT NULL DEFAULT 1;
-- 1 = carga retroactiva: jamás genera notificaciones ni alertas.
ALTER TABLE posts ADD COLUMN historical INTEGER NOT NULL DEFAULT 0;
-- Tipo de contenido tal como lo identificó la persona editora: publicacion | video | reel | foto
ALTER TABLE posts ADD COLUMN content_type TEXT;
