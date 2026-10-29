/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { pwaOptions } from './pwa/pwa.config.ts'

/** Identifica la compilación en uso: Workers Builds expone el commit; en local se toma de git. */
function buildCommit(): string {
  const fromCi = process.env.WORKERS_CI_COMMIT_SHA
  if (fromCi) return fromCi.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'local'
  }
}

export default defineConfig({
  define: { __BUILD_COMMIT__: JSON.stringify(buildCommit()), __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [react(), tailwindcss(), VitePWA(pwaOptions)],
  resolve: { alias: { '@shared': path.resolve(import.meta.dirname, 'shared'), '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'shared/**/*.test.ts', 'worker/**/*.test.ts'],
  },
})
