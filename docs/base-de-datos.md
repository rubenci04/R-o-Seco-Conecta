# Base de datos (Cloudflare D1)

Base: `rio-seco-conecta` (binding `DB`, plan gratuito). El identificador está en `wrangler.jsonc` (no es un secreto).

## Tablas activas (Sprint 04)
| Tabla | Uso |
|---|---|
| `sources` | Fuentes de contenido (Facebook, Instagram, redacción). Estado de conexión y sincronización. Facebook/Instagram quedan **deshabilitadas y sin credenciales**. |
| `categories` | Las 12 categorías editoriales (semilla). |
| `posts`, `post_categories` | Noticias: borrador / en revisión / publicada / rechazada / retirada, con categorías propuestas por el clasificador (con confianza) y confirmadas por una persona. |
| `alerts` | Alertas con vigencia, prioridad y confirmación editorial. |
| `obituaries` | Cola de revisión y obituarios aprobados por una persona. |
| `events` | Agenda (lugar por id textual del catálogo + texto). |
| `admins`, `admin_sessions` | Usuarios del panel (PBKDF2-SHA256) y sesiones (se guarda el hash del token). |
| `editorial_history` | Historial de toda modificación (quién, qué, cuándo). |
| `sync_runs` | Registro de sincronizaciones (vacío hasta conectar Meta). |

## Tablas preparadas, inactivas
`places`, `radios`, `bus_localities`, `bus_companies`, `bus_stops`, `bus_services` (los datos vigentes siguen en JSON validado: horarios reales, lugares con coordenadas, radios) y `push_subscriptions`, `notification_log` (Web Push, no activado). No se siembran ni se exponen por API.

## Migraciones (`migrations/`, versionadas, solo hacia adelante)
`0001_content` · `0002_editorial` · `0003_admin` · `0004_sync_push` · `0005_seed_reference` (solo categorías y fuentes). Wrangler lleva el control de versión del esquema en la tabla `d1_migrations`.
Reglas: **nunca se edita una migración ya aplicada en producción**; los cambios van en una migración nueva (`0006_…`). Una prueba verifica que no haya `DROP`/`DELETE`/`TRUNCATE`.

```bash
npm run db:migrate:local     # base local (desarrollo y pruebas)
npm run db:migrate:remote    # producción: ejecutar ANTES de desplegar código que dependa de la migración
```
> Workers Builds despliega el código pero **no aplica migraciones**: hay que correrlas a mano antes del push que las necesite.

## Respaldo y recuperación
- **Respaldo manual**: `npm run db:backup` → `backups/rio-seco-AAAA-MM-DD-HH-MM.sql` (carpeta fuera de Git: contiene datos y hashes de contraseñas). Hacerlo antes de cada migración en producción.
- **Time Travel** (D1): permite volver a cualquier minuto de los últimos 7 días (plan gratuito).
  `npx wrangler d1 time-travel info DB` y `npx wrangler d1 time-travel restore DB --timestamp=<ISO>`.
- **Restaurar desde un `.sql`**: crear una base nueva, `wrangler d1 execute <base> --remote --file backups/<archivo>.sql` y cambiar el `database_id` en `wrangler.jsonc`.

## Integridad
Claves foráneas activas; restricciones `CHECK` en estados, tipos y horarios; índices para el feed, la revisión editorial, alertas vigentes, agenda y obituarios. Las pruebas aplican las migraciones reales sobre SQLite y verifican estas reglas.
