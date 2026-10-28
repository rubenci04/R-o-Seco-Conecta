# Facebook oficial, importación y clasificación (Sprint 06)

Estado verificado el 28/10/2026. Lo que no se pudo comprobar con credenciales reales figura como **no verificado**.

## 1. Qué ven hoy los vecinos (sin credenciales ni acciones manuales)

**Page Plugin oficial de Facebook**, incrustado en *Inicio* («Desde Facebook») y en *Noticias* (bloque diferenciado, arriba del feed propio).

- **Probado en un navegador real**: el widget (`plugins/page.php?tabs=timeline`) muestra la cronología pública de **esta** página (Comuna De Rio Seco, ~8,5 mil seguidores) con sus publicaciones recientes —al probarlo mostró publicaciones de 5–6 días atrás— tanto aislado como dentro de la aplicación servida con su CSP real.
- Es contenido **de Facebook**: no entrega datos a la aplicación, por eso **no alimenta** el clasificador, las alertas ni las notificaciones. No es verificado por la redacción.
- Privacidad: **nada se carga desde Facebook hasta que la persona toca «Ver publicaciones de Facebook»** (Facebook puede usar cookies y registrar la visita). Se usa el `<iframe>` oficial (no el SDK de JavaScript), con `sandbox`, `loading="lazy"`, `referrerpolicy="origin"` y la CSP `frame-src https://www.facebook.com`. No se cargan scripts de terceros.
- Fallback: aviso si Facebook no responde en 8 s o el navegador lo bloquea (bloqueadores, cookies de terceros) y **enlace directo** a la página y a Instagram, siempre visible. No se simula ninguna cronología.
- Límite del widget: muestra unas pocas publicaciones recientes y no es una API (no hay fecha estructurada ni texto accesible para la aplicación).

## 2. Importación automática: qué falta

**No está activa** y no se simuló. Faltan credenciales aprobadas: ningún secreto de Meta está cargado, la fuente `facebook-comuna` está deshabilitada y el cron (cada minuto) **no llama a Meta** mientras no haya una fuente habilitada con credenciales (hay pruebas automáticas de eso).

### Vía A — Autorización de la Comuna (recomendada, viable)
1. Una persona **administradora de la página** de la Comuna debe tener un **rol en nuestra app de Meta** (administrador, desarrollador o probador) mientras la app esté en modo desarrollo.
2. Esa persona autoriza `pages_show_list` y `pages_read_engagement` (lectura de las publicaciones de su página). Se obtiene un **token de página de larga duración** (los derivados de un token de usuario de larga duración no vencen mientras no se revoquen permisos o cambie la contraseña).
3. **Resolver el Page ID por un procedimiento autorizado**: `GET /me/accounts?fields=id,name` con ese token. **No** se asume que el número de la URL pública (`61553018412844`) sea el Page ID de la Graph API.
4. Cargar como secretos de Cloudflare: `META_FACEBOOK_PAGE_ID`, `META_PAGE_ACCESS_TOKEN` (y `META_GRAPH_VERSION` si se quiere otra versión). Nunca en el repositorio ni en el chat.
5. En el panel: *Fuentes → Facebook*: habilitar, modo «API». Primer ciclo: importa hasta 5 publicaciones por minuto, de la más antigua a la más nueva, sin notificar históricos.
- Para pasar a modo en vivo con otras personas de la Comuna puede pedirse **App Review** de `pages_read_engagement` (acceso estándar sobre páginas que administra quien autoriza). Meta puede exigir además verificación de empresa; **confirmar en el momento del trámite**, porque las condiciones cambian.

### Vía B — Page Public Content Access (PPCA)
Función de Meta para leer publicaciones públicas de páginas que **no** administramos (`/page/feed`, `/page-post`).
- Requiere **App Review aprobado, verificación de empresa (Business Verification)** y puede exigir contratos adicionales. Hasta ser aprobada, solo se leen páginas cuyo administrador tenga rol en la app. En modo en vivo sin la función aprobada **no se ve ningún contenido público de páginas**.
- Uso permitido: «analizar y/o mostrar publicaciones y participación en páginas».
- Valoración: poco viable para un proyecto comunitario sin entidad verificable. **No se solicitó.**

### Instagram (@comunaderioseco)
El conector existe: modo `own` (cuenta profesional que administra la Comuna) o `business-discovery` (lectura pública desde **nuestra** cuenta profesional; requiere app aprobada con `instagram_basic` y `pages_read_engagement`, y que la cuenta objetivo sea Business/Creator). No está habilitado.

### Graph API
Versión por defecto: **v25.0** (antes v23.0). Registro de cambios de Meta: v26.0 (29/07/2026) es la más reciente; v25.0 disponible hasta 29/07/2028; v23.0 hasta 08/10/2027. Se eligió v25.0 por estable; cambiar con `META_GRAPH_VERSION`. **No verificado contra la API real** (sin credenciales); la prueba automática solo verifica la forma de la solicitud (versión en la URL, token en cabecera).

### Frecuencia
El cron corre **cada minuto**, pero eso **no garantiza** que Meta entregue datos cada minuto: la API tiene cuotas (cabeceras `x-app-usage`; sobre el 80 % la fuente espera 15 min), errores de límite (backoff exponencial) y token inválido/vencido (estado «auth-error», no se reintenta en bucle). Sin fuentes habilitadas, cada ejecución hace dos lecturas de D1 y nada más.

## 3. Qué requiere intervención hoy (importación asistida)

Mientras no haya autorización, un **editor** copia enlace y texto de cada publicación a *Panel → Fuentes → Importar publicaciones*:
- Una o **varias a la vez** (bloques separados por `---`, con `Fecha:` opcional).
- **Vista previa** antes de guardar: categorías con confianza, aviso propuesto, posible obituario, **duplicados** (misma publicación, mismo enlace, mismo texto o texto casi idéntico entre Facebook e Instagram) — sin guardar nada.
- **Compartir desde el teléfono**: la PWA instalada se registra como destino de «Compartir» (Web Share Target, solo Chrome/Android). Al compartir un enlace desde Facebook se abre la importación con el enlace cargado; **el texto casi siempre hay que pegarlo** (la app de Facebook no lo entrega al compartir; la aplicación no lo obtiene desde el enlace). Si no hay sesión iniciada, se pide ingresar y los datos compartidos se conservan en la dirección. No verificado en un dispositivo real.

## 4. Clasificación (una publicación, varias secciones)

- Un único registro por publicación (`posts`), con varias filas en `post_categories` (categoría, **confianza** y **motivo**).
- Aparece en el feed general y en cada categoría; nunca se duplica. Estados: importada → clasificada (`unreviewed/needs_review`) → pendiente de revisión (`pending`) → publicada → rechazada / corregida (rectificación) / retirada (`deleted`).
- **Residuos** (`residuos`): reglas por contexto (servicio + cambio en la misma oración). Una suspensión/reprogramación/cambio de recorrido propone un aviso de servicio **informativo**, nunca urgente; la recolección habitual no genera alerta.
- **Alertas**: siempre nacen como *propuestas*; confirmarlas es obligatorio (las urgentes, con permiso específico). Vencidas desaparecen de los avisos vigentes; la noticia queda en Noticias.
- **Obituarios**: todo posible aviso fúnebre queda oculto y sin notificar hasta que una persona confirma nombre y fecha. Entonces se publica en Obituarios y en el feed, y se notifica **solo** a quien lo eligió.
- Notificaciones: reutilizan Web Push cifrado del Sprint 05; un aviso que cubre un hecho no se repite como noticia; las importaciones históricas no notifican.

---

# Sprint 06B — Publicaciones individuales, embeds y recuperación (28/10/2026)

## 5. Revisión puntual de la última semana (realizada por el agente, NO es sincronización)

Se revisó la página pública de la Comuna **como lo haría un visitante sin cuenta**, en el navegador, el 28/10/2026 (período: 21 al 28/10/2026). Sin iniciar sesión, Facebook muestra la cabecera y las primeras publicaciones; al avanzar exige ingresar (no se creó cuenta, no se ingresaron credenciales ni se usaron cookies privadas, sesiones simuladas ni servicios de extracción).

| # | Enlace individual (público) | Tipo | Fecha visible | Texto accesible |
|---|---|---|---|---|
| 1 | `https://www.facebook.com/reel/986540003855732/` | reel (1:17) | «hace 2 horas» (relativa) | no: el reel público no muestra leyenda |
| 2 | `https://www.facebook.com/permalink.php?story_fbid=pfbid02NwcTTeDXFto3dWtpkCUTcmkJTiXSiF32qLsPhFMgEyxSaZoECjY4cK1PuJ33gqJ7l&id=61553018412844` | video (1:06) | «hace 5 días» (relativa) | no: la página de la publicación exige iniciar sesión |
| 3 | `https://www.facebook.com/reel/1104454118855678/` | reel (1:38) | «hace 5 días» (relativa) | no: sin leyenda pública |

- **Fechas**: sin sesión, Facebook solo da fechas relativas; **no se inventó una fecha absoluta**. Las tarjetas figuran como «Registrada el …» (fecha de registro, `date_verified = 0`).
- **Límite concreto**: sin sesión, la página muestra solo estas 3 publicaciones de la semana (la cronología se corta con el aviso de ingreso). **No se puede afirmar que sean todas**: pueden existir otras que solo ve quien tiene sesión. El Page Plugin tampoco entrega un listado utilizable por la aplicación.
- **Categorías**: ninguna. Son videos sin texto accesible; no se clasifica por la miniatura ni por la URL. Quedan solo en el feed general hasta que una persona vea el video y asigne categorías.
- Esto fue una **revisión puntual**. La **sincronización automática permanente no existe** hasta que haya credenciales (sección 9).

## 6. Embeds individuales oficiales de Meta (probado en navegador real)

Referencia: `meta/meta-embeds-for-wordpress`. La adaptación a React **no usa el SDK ni scripts de Meta**: es un `<iframe>` a las direcciones oficiales de plugin, que no requieren token para publicaciones públicas.

| Contenido | Dirección usada | Resultado probado (28/10/2026) |
|---|---|---|
| Reel / video | `https://www.facebook.com/plugins/video.php?href=<URL>&show_text=true&width=<n>` | **funciona** con los reels 1 y 3 |
| Enlace `permalink.php?story_fbid=pfbid…` | `https://www.facebook.com/plugins/post.php?href=<URL>&show_text=true&width=<n>` | **funciona** con el video 2 (aunque su página exige sesión) |
| Un reel pedido por `plugins/post.php` | — | **no se muestra** (por eso reels y videos usan `video.php`) |
| Instagram | `<URL de la publicación>embed/` | implementado; **no probado** (no hay enlaces de Instagram verificados) |

- En la aplicación: botón **«Ver la publicación original»**; **nada se pide a Meta hasta tocarlo** (privacidad); `<iframe>` con `loading="lazy"`, `sandbox`, `referrerpolicy="origin"` y CSP `frame-src https://www.facebook.com https://www.instagram.com`. Siempre queda visible **«Abrir la publicación en Facebook»** para lo que Facebook no deje incrustar o un bloqueador impida.
- **No se lee el interior del iframe** ni se asume que un embed entrega texto: no alimenta clasificador, alertas ni notificaciones.
- Solo se incrusta una dirección con identificador de publicación (`/reel/…`, `/videos/…`, `/posts/…`, `permalink.php?story_fbid=…`, `pfbid…`). La URL de la página no se incrusta.

## 7. Qué se puede cargar hoy, por rol

| Tarea | Dónde | Quién |
|---|---|---|
| Registrar una publicación **solo con el enlace** (título, tipo y categorías que la persona comprobó; fecha solo si la comprobó) | Panel → Fuentes → *Registrar publicación de Facebook* | editor o administrador |
| Importar con **enlace + texto** (clasifica con las reglas existentes) | Panel → Fuentes → *Importar publicaciones* | editor o administrador |
| **Completar** una tarjeta enlazada con el texto original (misma tarjeta, sin duplicar) | Panel → Noticias → la tarjeta → *Completar con el texto original* | editor o administrador |
| **Recuperar publicaciones anteriores** (período, varios enlaces, revisión una por una, publicación en bloque solo de categorías seguras) | Panel → Recuperar | editor o administrador |
| Vistas del flujo editorial: *Por clasificar*, *En revisión* (pendientes de aprobar), *Cargadas por enlace*, *Históricas*, *Publicadas* | Panel → Noticias | todos los roles (lectura) |
| Aprobar obituarios y confirmar alertas | Panel → Obituarios / Alertas | editor o administrador |
| Ver todo / gestionar usuarios | — | solo lectura / administrador |

Reglas de las tarjetas **solo con enlace**: sin resumen inventado ni «analizada»; sin categorías automáticas; **nunca** alertas ni obituarios automáticos (los obituarios se cargan desde su cola, con nombre y fecha verificados); **nunca** notificaciones; fecha de registro rotulada como tal; la tarjeta dice «Publicación externa enlazada» y «Sin revisión editorial» salvo que la persona marque «vi la publicación y confirmo».

**Recuperación retroactiva**: todo lo importado queda `historical = 1`: no notifica (tampoco al aprobarlo después), no propone avisos, conserva las fechas **solo si fueron verificadas** y respeta el período elegido. Con *Publicar en bloque* solo salen solas las categorías seguras (institucional, eventos, cultura, deportes, educación, salud, otros) **y** revisadas por la persona; **obituarios, agua, energía, calles, residuos y meteorología siempre quedan en revisión**.

Estados: aviso vigente / vencido (las alertas vencen solas), publicación histórica (etiqueta), contenido externo sin revisión («Sin revisión editorial») y comunicado revisado («Revisada por la redacción»). Si una publicación original se retira o se rectifica: *Retirar de la aplicación* y *Rectificación* en el editor de la tarjeta; el historial de ediciones está en esa misma pantalla.

## 8. Invitar a otra persona al panel sin compartir la contraseña principal

1. Un **administrador** entra a *Panel → Usuarios* y crea un usuario con el **correo de esa persona** y el rol **Editor** (carga y revisa contenidos) o **Solo lectura**.
2. Define una contraseña **temporal** (mínimo 12 caracteres) y se la entrega por un canal privado distinto del correo.
3. La persona entra y en *Mi cuenta* **cambia su contraseña** de inmediato.
4. Cada acción queda en el historial con **su** correo. Si deja de colaborar: *Usuarios → desactivar* (la cuenta deja de funcionar y se cierran sus sesiones).
- No hace falta compartir la cuenta del administrador. Recomendación: un administrador (decide obituarios y alertas urgentes) y uno o más editores.

## 9. Automatización permanente con la API de Meta (NO activa)

**Estado**: el conector `FacebookPageConnector` está implementado y probado solo con respuestas simuladas; **la integración NO está activa ni se marca como activa** (fuente deshabilitada, sin credenciales). No se afirma sincronización hasta que un ciclo real traiga datos.

Pasos exactos para activarlo:
1. **Quién**: una persona **administradora de la página de Facebook de la Comuna**. No necesitamos su contraseña.
2. **Aplicación de Meta**: en <https://developers.facebook.com> se crea una app («Río Seco Conecta»), se agrega a esa persona como **rol de la app** (desarrollador o probador) y la app queda en **modo desarrollo** (suficiente mientras quien autoriza tenga rol en la app).
3. **Qué autoriza esa persona**, con su propia sesión: `pages_show_list` y `pages_read_engagement` sobre la página de la Comuna. **No** se piden `pages_manage_posts`, ni mensajes (`pages_messaging`), ni ningún permiso de publicación: la aplicación **solo lee** publicaciones.
4. **Token**: con ese permiso se obtiene un token de usuario → se extiende a larga duración → se pide el **token de la página** con `GET /me/accounts?fields=id,name,access_token`. Ese mismo resultado entrega el **Page ID real** (no se usa el número de la URL pública).
5. **Secretos** (solo en Cloudflare, nunca en el repositorio ni en el chat): `META_FACEBOOK_PAGE_ID` y `META_PAGE_ACCESS_TOKEN` (`wrangler secret put …`).
6. **Panel → Fuentes → Facebook**: habilitar en modo *API*. El cron (cada minuto) pasa a consultar la página de forma incremental.
- **Qué debe aprobar Meta**: para que **quien administra la página y tiene rol en la app** autorice, nada (modo desarrollo). La **revisión de la app (App Review)** de `pages_read_engagement` (y, según el caso, la verificación de empresa) solo hace falta para pasar la app a modo *en vivo* o leer páginas cuyo administrador no tiene rol en la app. **Page Public Content Access** exige App Review + Business Verification: no se solicitó.
- **Qué se automatiza con un token válido**: recuperar las publicaciones recientes (fecha, texto y enlace permanente), **completar las tarjetas ya registradas por enlace** (se reconoce la misma publicación y se completa, no se duplica), clasificarlas con las reglas existentes y seguir las nuevas de forma incremental. Los posibles obituarios y avisos siguen exigiendo confirmación humana y lo histórico no notifica.
- **Qué sigue fuera de nuestro control**: cuota de la API y vigencia del token (se detecta y se muestra «Credencial inválida o vencida»).
