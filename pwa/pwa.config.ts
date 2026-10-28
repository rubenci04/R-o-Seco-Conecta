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
  background_color: '#f4f9fd',
  theme_color: '#1769a8',
  categories: ['news', 'travel', 'utilities'],
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
} as const

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: 'autoUpdate',
  includeAssets: ['favicon.ico', 'favicon-32.png', 'favicon-48.png', 'icons/apple-touch-icon.png', 'brand/logo-sign.webp', 'brand/entrada.webp'],
  manifest: manifest as unknown as VitePWAOptions['manifest'],
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
    navigateFallback: '/index.html',
    cleanupOutdatedCaches: true,
  },
}
