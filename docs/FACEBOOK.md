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
