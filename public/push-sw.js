/*
 * Notificaciones push de Río Seco Conecta. Lo carga el service worker de la PWA con importScripts (no hay un segundo SW),
 * así el caché, la instalación y la actualización automática siguen siendo los de siempre.
 *
 * Reglas:
 *  - El contenido llega CIFRADO en el propio mensaje push (RFC 8291): cada aviso trae su título, texto y dirección.
 *    No se consulta ningún «último aviso»: es imposible mostrar el texto de otra publicación.
 *  - Toda notificación push se muestra siempre (Safari/iOS exige que no sean silenciosas). Si el mensaje no se puede
 *    interpretar se muestra un aviso genérico que solo abre la aplicación.
 *  - Nada del contenido se guarda en cachés.
 */
const PUSH_FALLBACK = { title: 'Río Seco Conecta', body: 'Hay novedades en tu comunidad. Tocá para verlas.', url: '/', id: 0, urgent: false }
const PUSH_ICON = '/icons/icon-192-v2.png'

/** Acepta solo rutas internas de la aplicación: jamás un enlace externo. */
function safeAppPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/'
  return value.slice(0, 300)
}

function parsePushPayload(data) {
  if (!data || typeof data !== 'object' || data.v !== 1 || typeof data.title !== 'string' || !data.title.trim()) return PUSH_FALLBACK
  return {
    id: Number.isInteger(data.id) ? data.id : 0,
    title: data.title.slice(0, 120),
    body: typeof data.body === 'string' ? data.body.slice(0, 240) : '',
    url: safeAppPath(data.url),
    urgent: data.urgent === true,
  }
}

async function showPush(event) {
  let raw = null
  try {
    raw = event.data ? event.data.json() : null
  } catch {
    raw = null
  }
  const n = parsePushPayload(raw)
  await self.registration.showNotification(n.title, {
    body: n.body,
    icon: PUSH_ICON,
    lang: 'es-AR',
    // El identificador del aviso evita duplicados si el servicio push lo entrega dos veces.
    tag: n.id ? 'rsc-' + n.id : 'rsc-general',
    requireInteraction: n.urgent,
    data: { url: n.url, id: n.id },
  })
}

/** Abre el contenido exacto del aviso reutilizando una ventana abierta de la app (sin duplicar ventanas). */
async function openFromNotification(notification) {
  const target = new URL(safeAppPath(notification && notification.data && notification.data.url), self.location.origin).href
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of windows) {
    if (!client.url.startsWith(self.location.origin)) continue
    try {
      await client.focus()
      if (client.url !== target && typeof client.navigate === 'function') await client.navigate(target)
      else if (client.url !== target) client.postMessage({ type: 'rsc-open', url: target })
      return
    } catch {
      // Si la ventana no se puede reutilizar se abre una nueva.
    }
  }
  await self.clients.openWindow(target)
}

self.addEventListener('push', (event) => {
  event.waitUntil(showPush(event))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(openFromNotification(event.notification))
})

// Expuesto solo para las pruebas automáticas.
self.rscPush = { parsePushPayload, safeAppPath, PUSH_FALLBACK }
