# Notificaciones push (Sprint 05)

Notificaciones **reales** en el celular o la computadora del vecino cuando se publica una noticia relevante o se confirma una alerta. Sin cuentas, sin servicios pagos.

## Arquitectura de envío

**Web Push estándar con carga útil cifrada de extremo a extremo (RFC 8291) y VAPID (RFC 8292), enviado desde el propio Worker.**

```
Panel → publicar noticia / confirmar alerta
        └─ reglas editoriales (shared/notificationPolicy.ts)  → notification_log (clave única = sin duplicados)
              └─ ctx.waitUntil: primera tanda inmediata ─┐
              └─ cron cada 5 min: continúa lotes y reintentos ─┴→ notification_deliveries (una fila por aviso+dispositivo)
                        └─ POST cifrado al servicio push (FCM / Mozilla / Apple / Windows) → el navegador muestra el aviso
```

- **Cada mensaje trae su propio título, texto y dirección** (`{ v, id, type, title, body, url, urgent }`), cifrado con las claves del dispositivo. El servicio push no puede leerlo. El service worker lo muestra tal cual: **no consulta ningún «último aviso»**, por lo que es imposible mostrar el contenido de otra publicación. El endpoint anterior `/api/public/notifications/latest` fue **eliminado**.
- Al tocar la notificación se abre `/noticias/:id`, `/alertas/:id` u `/obituarios/:id`: exactamente el contenido que la originó.
- Un mismo aviso nunca se envía dos veces al mismo dispositivo: `UNIQUE(notification_id, subscription_id)` y reclamo atómico de envíos (`UPDATE … RETURNING` con ventana de 2 minutos) frente a ejecuciones simultáneas (cron + envío inmediato).
- Reintentos con espera creciente (5 min, 30 min, 2 h; 4 intentos) solo para errores temporales (red, 429, 5xx). `404/410` = suscripción revocada → se da de baja y no se reintenta. Un aviso que supera su TTL (6 h; 1 h si es urgente) no se entrega tarde.

## Quién recibe qué

| Origen | Condición | Audiencia | Prioridad |
|---|---|---|---|
| Noticia publicada | reciente (≤ 6 h), publicada, no carga masiva (> 3 en un ciclo), no cubierta por una alerta | suscriptos a alguna de **sus categorías** | normal |
| Alerta **urgente** confirmada por una persona | vigente | «Alertas urgentes» **o** el tema de su tipo | alta (TTL 1 h) |
| Alerta informativa confirmada | vigente | solo el tema de su tipo | normal |
| Obituario | **aprobado por una persona** | solo quien eligió «Obituarios» | normal |

- Una alerta nunca nace de una palabra suelta: las detectadas quedan «propuestas» y solo salen al **confirmarlas** una persona con el permiso correspondiente.
- Una noticia que originó una alerta no genera un segundo aviso (lo da la alerta).
- Importaciones históricas o noticias viejas no generan avisos.
- Dispositivos de prueba (administración) nunca reciben avisos reales y su prueba va únicamente a ellos. **No existe un envío masivo manual.**

## Temas elegibles

Alertas urgentes · Cortes de agua · Cortes de electricidad · Calles cortadas · Alertas meteorológicas · Noticias institucionales · Eventos y festividades · Cultura · Deportes · Educación · Salud · Otras novedades · Obituarios (solo por elección expresa). Nada viene tildado salvo la configuración inicial «Solo avisos importantes» (urgentes, agua, electricidad, calles, meteorológicas), que la persona puede cambiar antes de activar.

## Seguridad

- Endpoints aceptados solo de servicios push conocidos (`fcm.googleapis.com`, `push.services.mozilla.com`, `push.apple.com`, `notify.windows.com`), HTTPS, puerto 443, sin credenciales; se **revalida al enviar**. Impide SSRF.
- Claves `p256dh` (65 bytes, P-256) y `auth` (16 bytes) validadas.
- Propiedad: al registrarse se entrega un **token de gestión** (solo se guarda su hash SHA-256). Modificar, consultar o dar de baja exige endpoint + token; sin él, 403. Los IDs de suscripción no se exponen.
- Límite de solicitudes por origen y acción (D1, `rate_limits`, se guarda hash de la IP) y tope de 5000 dispositivos activos.
- Datos mínimos: endpoint, claves, temas, servicio y fechas. **Sin GPS, nombre ni datos personales.** Al desactivar se borra la fila.
- Limpieza (cron, 1 vez por hora): dispositivos dados de baja > 30 días, avisos > 90 días, contadores de abuso.
- Las claves privadas son secretos de Cloudflare: nunca en Git ni en el frontend.

## Claves VAPID

Generar y guardar **como secretos** (no imprime la clave privada, no la escribe en disco):

```bash
npm run vapid:generate
```

Cargan `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY_JWK`. `VAPID_SUBJECT` (URL pública de contacto) está en `wrangler.jsonc`.

- **No volver a generar si ya hay suscripciones**: la clave pública está atada a cada suscripción del navegador. Si cambia, los servicios push rechazan los envíos (403) y cada persona debe reactivar las notificaciones.
- **Rotación**: planificarla como migración. 1) generar un par nuevo, 2) avisar en la app que hay que reactivar las notificaciones, 3) cargar los secretos nuevos, 4) las suscripciones viejas fallarán con 403/410 y se darán de baja solas. No hay rotación transparente en Web Push.
- **Recuperación**: si se pierde la clave privada, es igual que una rotación (se generan nuevas y la gente reactiva). Para no perderla, guardá el JWK en el administrador de contraseñas al generarla (modificar el script para mostrarla solo si lo necesitás; por defecto no se muestra).
- Sin claves, la API responde «no disponible», el panel lo indica y **nada se marca como enviado**.

## Compatibilidad

- **Android / escritorio** (Chrome, Edge, Firefox): funciona desde el navegador.
- **iPhone / iPad**: solo con la app **instalada en la pantalla de inicio** (iOS/iPadOS 16.4+). La pantalla lo explica. Los avisos nunca son silenciosos (Safari lo exige).
- El service worker es **el mismo** de la PWA (`importScripts('push-sw.js')`): se conserva la instalación, la actualización automática y el caché. `/api/admin/*` nunca se cachea; el contenido de las notificaciones no se guarda en ningún caché.

## Consumo en el plan gratuito

Límites relevantes: ≈50 subrequests y **10 ms de CPU por invocación**, 100 000 solicitudes/día, D1 100 000 escrituras/día.

- Cron `*/5 * * * *` = 288 ejecuciones/día; sin avisos pendientes consulta una sola fila de D1.
- **Lote de 12 dispositivos por invocación** (`PUSH_BATCH_SIZE`). El cifrado cuesta ≈0,3–0,45 ms por mensaje (medido en Node; se reutiliza una clave efímera por invocación). En workerd real **todavía no está medido**: después del primer envío real hay que mirar el `cpuTime` en Observability; si hubiera errores «Exceeded CPU», bajar el lote.
- Consecuencia: la primera tanda sale al instante (al publicar) y el resto cada 5 minutos → ≈ 12 dispositivos cada 5 min, es decir **100 suscriptores se completan en ≈ 40 min**. Las alertas urgentes se atienden primero. Si la audiencia crece, las opciones son: Workers de pago (CPU 30 s; subir el lote a 40) o encadenar tandas (pendiente, requiere verificar llamadas del Worker a sí mismo).
- Escrituras D1 por aviso ≈ 1 + dispositivos × 2: con 500 suscriptores y 10 avisos al día ≈ 10 000 escrituras.
- Tope de 5000 dispositivos activos.

## Pruebas manuales pendientes

Las automáticas verifican el cifrado contra el vector del RFC, el descifrado en un servidor push simulado y toda la lógica. **No reemplazan** la recepción real:
1. En un Android (Chrome): activar en *Más → Configuración → Mis notificaciones*, y desde el panel (*Notificaciones → Registrar este navegador → Enviar prueba*).
2. En un iPhone: instalar la PWA, abrir desde el ícono, activar y probar.
3. Publicar una noticia de una categoría elegida y comprobar que llega y abre la noticia correcta.
4. Confirmar una alerta urgente y comprobar la prioridad.
