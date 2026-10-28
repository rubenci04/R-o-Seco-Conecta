import { defineConfig, devices } from '@playwright/test'

/**
 * Dos servidores:
 *  - 4173: PWA estática en modo «local» (datos JSON) → pruebas públicas existentes.
 *  - 8787: Worker dinámico real (wrangler dev) con D1 local aislada → pruebas del panel y de contenido dinámico.
 */
export default defineConfig({
  testDir: './e2e',
  webServer: [
    { command: 'npm run build:e2e && npm run preview:e2e', port: 4173, reuseExistingServer: true, timeout: 180_000 },
    { command: 'npm run build && node e2e/worker-server.mjs', port: 8787, reuseExistingServer: false, timeout: 300_000 },
  ],
  projects: [
    { name: 'movil', testIgnore: /admin\.spec\.ts/, use: { ...devices['Pixel 7'], baseURL: 'http://localhost:4173' } },
    { name: 'escritorio', testIgnore: /admin\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4173' } },
    // El panel comparte base de datos: los proyectos de administración se ejecutan de a uno.
    { name: 'admin-escritorio', testMatch: /admin\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:8787' } },
    { name: 'admin-movil', testMatch: /admin\.spec\.ts/, dependencies: ['admin-escritorio'], use: { ...devices['Pixel 7'], baseURL: 'http://localhost:8787' } },
  ],
})
