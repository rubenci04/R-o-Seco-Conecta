# Panel de administración (`/admin`)

Acceso privado en https://rio-seco-conecta.rea-04.workers.dev/admin (no se indexa, no se guarda en caché, usa una CSP restrictiva).

## Primer administrador y recuperación de acceso
No hay usuarios ni contraseñas por defecto. El primer administrador se creó con una **contraseña aleatoria** guardada solo en `.secrets/admin-inicial.txt` (carpeta ignorada por Git). Al ingresar: **cambiala en «Mi cuenta» y borrá ese archivo**.

Crear o restablecer un administrador (también sirve si se perdió el acceso; cierra todas sus sesiones y desbloquea la cuenta):
```bash
npm run admin:create -- --email persona@ejemplo.com --name "Nombre" --role admin --remote
```
La contraseña se pide por la consola sin mostrarla (o `ADMIN_PASSWORD` en el entorno de esa orden). Nunca pegues contraseñas en chats, issues ni commits.

## Roles (comprobados en el servidor)
| Rol | Puede |
|---|---|
| Administrador | Todo: contenido, aprobaciones, fuentes y usuarios. |
| Editor | Crear/editar/publicar/retirar noticias, alertas (incluida la confirmación urgente), eventos y obituarios. |
| Solo lectura | Ver el panel; no modifica nada. |

## Qué se puede hacer
- **Panel**: contadores, próximos eventos, estado de las fuentes y últimas modificaciones.
- **Noticias**: crear, guardar borrador, publicar, editar, categorizar (el sistema propone y vos confirmás), retirar, rectificar (se muestra en la nota), ver fuente, fecha e historial.
- **Alertas**: tipo (agua, energía, calles, meteorológica, aviso), gravedad, prioridad, inicio y vencimiento; solo se publican **confirmadas**; las vencidas dejan de mostrarse solas.
- **Agenda**: eventos y festividades (p. ej. diciembre/pesebres) en hora de Tucumán, con lugar del catálogo, fuente y publicar/despublicar.
- **Obituarios**: cola de revisión; hace falta confirmar nombre y fecha; aprobar los publica en «Obituarios» y en el feed; permite rectificar y retirar.
- **Fuentes**: estado de Facebook/Instagram (sin credenciales), importación asistida por enlace + texto, errores de sincronización.
- **Usuarios** (administrador) y **Mi cuenta** (cambio de contraseña).

## Rutas de la API
Públicas (solo lectura, con ETag): `GET /api/health`, `/api/public/categories`, `/api/public/feed?categoria=&antes=&limite=`, `/api/public/alerts`, `/api/public/events`, `/api/public/obituaries`.
Administrativas (`/api/admin/*`, sesión + cabecera CSRF `x-rsc-csrf: 1`): `login`, `logout`, `me`, `password`, `dashboard`, `posts` (+`/:id`, `publish`, `reject`, `rectify`, `import-link`), `obituaries` (+`approve`, `reject`, `retract`, `rectify`), `alerts` (+`confirm`, `dismiss`), `events`, `sources` (+`sync-now`), `sync-runs`, `history`, `users`.
No existen en producción: lugares, radios, transporte ni Web Push por API.

## Seguridad aplicada
PBKDF2-SHA256 (100 000 iteraciones, sal propia) · cookie `HttpOnly; Secure; SameSite=Strict; Path=/api` · token de sesión guardado solo como hash · sesiones de 8 h · bloqueo tras 5 intentos fallidos (15 min) · CSRF por cabecera + `Origin` · permisos por rol en cada ruta · entradas validadas (URLs solo http/https, fechas, estados) · contenido tratado como texto (React lo escapa) · la API administrativa exige sesión antes de resolver rutas (no revela cuáles existen) · cambio de contraseña cierra las demás sesiones · sin secretos en el cliente.

## Facebook e Instagram (pendiente de permisos de Meta)
Los conectores existen y están probados con respuestas simuladas, pero **no están activos**: faltan credenciales y permisos. Mientras tanto, importación asistida por enlace (no descarga nada de Meta). Ver `docs/mapa.md` y el informe del Sprint 04 para los permisos a solicitar.
