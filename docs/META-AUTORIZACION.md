# Conectar el Facebook de la Comuna (autorización oficial de Meta)

Estado al 29/10/2026: **no conectado**. El conector está implementado y probado solo con respuestas simuladas de la Graph API. Nada se afirma como funcionando hasta probarlo con un token válido.

## Guía corta (lo único que falta es humano)

1. **Pantalla**: <https://developers.facebook.com/apps> → **Crear app** → caso de uso **«Administrar todo en tu página»** (si no aparece, «Otro» → tipo «Empresa») → nombre «Río Seco Conecta». Dejar en **modo Desarrollo**.
2. **Opción**: en *Casos de uso → Personalizar* agregar solo `pages_show_list` y `pages_read_engagement`. Nada de `pages_manage_posts` ni mensajería.
3. **Administrador de la página** (necesita poder «Moderar» la página): *Roles de la app → Agregar personas* → su cuenta como Desarrollador/Probador → aceptar en <https://developers.facebook.com/requests>. Luego en el [Explorador de la API](https://developers.facebook.com/tools/explorer/): elegir la app, marcar los dos permisos, **Generate Access Token** y **elegir la página de la Comuna** en el diálogo.
4. **El script necesita**: ese token de usuario en la variable `META_USER_TOKEN` y el Page ID (lo lista el mismo script).
5. **Cargar sin exponer** (PowerShell): `$env:META_USER_TOKEN = Read-Host` (pegar el token, no se imprime en archivos ni chat) → `node scripts/meta-connect.mjs` (lista páginas) → `node scripts/meta-connect.mjs --page-id <ID>` (los guarda como secretos de Cloudflare) → `Remove-Item Env:META_USER_TOKEN`. Después, *Panel → Fuentes → Facebook → habilitar, modo API*.

Fuente de los requisitos: referencia de la Graph API de Páginas (token de página de quien puede «Moderar» + `pages_read_engagement` + `pages_show_list`). La guía «Pages API» de Meta nombra a veces `pages_manage_read_engagement`: si la primera lectura real devuelve el error #10/#200, esa es la pista del permiso que falta.

Importación inicial: lo publicado hasta el momento de la conexión (se guarda `connectedAt` en la fuente) nunca genera notificaciones; la lectura recorre todas las páginas de resultados.

## Permisos: mínimos y por modo

| Permiso | Para qué | Modo desarrollo | Modo en vivo |
|---|---|---|---|
| `pages_show_list` | listar las páginas de la persona y obtener el Page ID real y el token de página | sin revisión, para personas con rol en la app | requiere App Review |
| `pages_read_engagement` | leer las publicaciones de la página (`/{page-id}/published_posts`) | sin revisión, para personas con rol en la app | requiere App Review (+ posible verificación de empresa) |

No se piden: `pages_manage_posts` (publicar), `pages_messaging` (mensajes privados), `pages_manage_*` (administrar personas, comentarios, etc.). Con la app en **modo desarrollo** y la persona que autoriza como **administrador/desarrollador/probador de la app**, no hace falta revisión. (Fuente: documentación de permisos de Meta; el comportamiento exacto de `published_posts` en modo desarrollo **se confirma recién con la primera prueba real**.) Page Public Content Access (leer páginas ajenas) exige revisión y verificación de empresa: **no se usa**.

## Pasos

### A. Una sola vez, por el equipo del proyecto (cuenta de Facebook propia)
1. Abrir <https://developers.facebook.com/apps> → **Crear app** → caso de uso **Otro** → tipo **Empresa** → nombre «Río Seco Conecta». Dejarla en **modo Desarrollo**.
2. **Roles de la app** (menú *Roles de la app → Roles*) → **Agregar personas** → agregar a quien administra la página de la Comuna (el delegado u otra persona) como **Desarrollador** o **Probador**. Esa persona recibe una invitación y debe **aceptarla** en <https://developers.facebook.com/requests>.

### B. Por quien administra la página de la Comuna (con su propia sesión; nunca comparte su contraseña)
1. Abrir <https://developers.facebook.com/tools/explorer/> y elegir la app «Río Seco Conecta».
2. En **Permisos** marcar solo `pages_show_list` y `pages_read_engagement` → **Generate Access Token** → en la ventana de Facebook elegir **la página de la Comuna** y **aprobar** ambos permisos (lectura).
3. Copiar el **token de usuario** que aparece (NO enviarlo por chat ni correo).

### C. En la computadora del proyecto (el token solo vive en esa terminal)
```powershell
$env:META_USER_TOKEN = "<token de usuario>"
node scripts/meta-connect.mjs            # lista las páginas: id y nombre (el Page ID real)
node scripts/meta-connect.mjs --page-id <ID de la Comuna>   # carga META_FACEBOOK_PAGE_ID y META_PAGE_ACCESS_TOKEN como secretos de Cloudflare
Remove-Item Env:META_USER_TOKEN
```
El token de página obtenido a partir de un token de usuario de larga duración no vence mientras no se revoquen permisos ni cambie la contraseña. Si el token de usuario del Explorador es de corta duración (≈1 h), el token de página derivado puede no ser permanente: **extenderlo** antes con *Herramienta de depuración de tokens → Extender token de acceso*, o pedir a Meta un token de larga duración (`/oauth/access_token?grant_type=fb_exchange_token…`) desde la misma herramienta.

### D. En el panel de Río Seco Conecta
**Panel → Fuentes → Comuna de Río Seco · Facebook** → habilitar, modo **API**. El cron (cada minuto) empieza a leer.

## Qué hace el sistema una vez conectado
- **Primera lectura**: recupera primero los **últimos 7 días**, de la más antigua a la más nueva, sin notificar (carga histórica). Cuántas se incorporaron queda en *Fuentes → sincronizaciones* (leídas / incorporadas / duplicadas).
- **Lectura incremental**: guarda la fecha de la última publicación vista y de la última sincronización (`sources.cursor`, `last_success_at`).
- **Con texto**: se clasifica (varias categorías, sin duplicar). Posibles obituarios → cola de revisión; avisos → propuesta que una persona confirma; nunca se notifica sin aprobación humana.
- **Sin texto (imagen, aviso gráfico, video)**: se conserva con su enlace, tipo, fecha original e imagen que entrega la API; queda **pendiente de clasificación** (*Noticias → Por clasificar*) y nunca genera obituarios ni alertas por deducción.
- **Tarjetas ya registradas por enlace**: se completan con el texto, no se duplican.
- Errores: token inválido/vencido → estado «Credencial inválida o vencida» (no se reintenta en bucle); límites de la API → espera con backoff.

## Siguiente verificación (cuando haya token)
Publicar algo en la página (o esperar la próxima) y comprobar que en ≤ 1–2 minutos aparece en D1 y en la app, clasificado. Solo entonces se considera la conexión «probada».
