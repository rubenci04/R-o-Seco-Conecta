import type { VitePWAOptions } from 'vite-plugin-pwa'

export const manifest = {
  id: '/',
  name: 'Río Seco Conecta',
  short_name: 'Río Seco',
  description:
    'Información comunitaria de Río Seco, Tucumán: colectivos, noticias, radios y agenda. Aplicación independiente, no oficial.',
  lang: 'es-AR',
  dir: 'ltr',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#f3fafd',
  theme_color: '#0b6b97',
  categories: ['news', 'travel', 'utilities'],
  icons: [
    { src: '/icons/icon-192-v2.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-maskable-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
} as const

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: 'autoUpdate',
  includeAssets: ['favicon.ico', 'favicon-32-v2.png', 'favicon-48-v2.png', 'icons/apple-touch-icon-v2.png', 'brand/logo-v2.png', 'brand/logo-mark-v2.png', 'brand/entrada.webp'],
  manifest: manifest as unknown as VitePWAOptions['manifest'],
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
    navigateFallback: '/index.html',
    cleanupOutdatedCaches: true,
    // Notificaciones push dentro del MISMO service worker (sin un segundo SW): public/push-sw.js.
    importScripts: ['push-sw.js'],
    // El código del mapa (Leaflet, ~365 KB) NO se precachea: solo se guarda tras abrir el mapa por primera vez.
    globIgnores: ['**/PlacesMap-*.{js,css}', '**/AdminApp-*.js'],
    // Nunca interceptar la API con el fallback de navegación de la PWA.
    navigateFallbackDenylist: [/^\/api\//],
    runtimeCaching: [
      {
        urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) => sameOrigin && /\/assets\/PlacesMap-[^/]+\.(js|css)$/.test(url.pathname),
        handler: 'CacheFirst',
        options: { cacheName: 'rio-seco-map-code', expiration: { maxEntries: 4 } },
      },
      // Lectura sin conexión de noticias, alertas, agenda y obituarios: red primero, y la última respuesta como respaldo (24 h).
      // La API administrativa (/api/admin) NUNCA se guarda.
      {
        urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) => sameOrigin && url.pathname.startsWith('/api/public/'),
        handler: 'NetworkFirst',
        options: { cacheName: 'rio-seco-api', networkTimeoutSeconds: 4, expiration: { maxEntries: 30, maxAgeSeconds: 24 * 3600 } },
      },
      // Las teselas de OpenStreetMap NO se guardan (política de uso: sin descargas masivas ni mapas offline).
    ],
  },
}
