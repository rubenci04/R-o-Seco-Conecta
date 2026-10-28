// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../worker/index'
import { PRODUCTION_FEATURES } from '../../worker/features'

/** Lee un JSONC (con comentarios y comas finales). */
const jsonc = (file: string) => JSON.parse(readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '').replace(/,(\s*[}\]])/g, '$1'))

describe('despliegue dinámico: wrangler.jsonc', () => {
  const cfg = jsonc('wrangler.jsonc')
  it('un solo Worker con la PWA como assets y la API bajo /api/*, en el mismo dominio', () => {
    expect(cfg.name).toBe('rio-seco-conecta') // el nombre del Worker en Cloudflare debe coincidir
    expect(existsSync(cfg.main)).toBe(true)
    expect(cfg.main).toBe('worker/index.ts')
    expect(cfg.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(cfg.assets).toMatchObject({ directory: './dist', binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: ['/api/*'] })
  })
  it('enlaza D1 con la binding DB, un identificador real y las migraciones del repositorio', () => {
    expect(cfg.d1_databases).toHaveLength(1)
    const [db] = cfg.d1_databases
    expect(db).toMatchObject({ binding: 'DB', database_name: 'rio-seco-conecta', migrations_dir: 'migrations' })
    expect(db.database_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(db.database_id).not.toBe('00000000-0000-0000-0000-000000000000')
    expect(existsSync(db.migrations_dir)).toBe(true)
  })
  it('el cron (cada minuto) solo trabaja si hay envíos pendientes o una fuente habilitada con credenciales y no hay secretos ni variables sensibles en el archivo', () => {
    expect(cfg.triggers).toEqual({ crons: ['* * * * *'] })
    expect(Object.keys(cfg.vars)).toEqual(['VAPID_SUBJECT']) // contacto público; las claves VAPID son secretos de Cloudflare
    expect(cfg.vars.VAPID_SUBJECT).toMatch(/^https:\/\//)
    expect(JSON.stringify(cfg).toLowerCase().replace(/vapid_subject/g, '')).not.toMatch(/token|secret|password|private|vapid|api[_-]?key/)
  })
  it('la configuración estática anterior se conserva solo como respaldo y no tiene Worker ni D1', () => {
    const fallback = jsonc('wrangler.static.jsonc')
    expect(fallback.main).toBeUndefined()
    expect(fallback.d1_databases).toBeUndefined()
    expect(fallback.assets.not_found_handling).toBe('single-page-application')
    expect(fallback.name).toBe(cfg.name)
    expect(existsSync('wrangler.worker.jsonc')).toBe(false) // el backend ya está unificado: no queda una configuración paralela
  })
  it('el build verifica tipos del frontend y del Worker, y «npm run deploy» usa la configuración dinámica por defecto', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.scripts.build).toContain('typecheck')
    expect(pkg.scripts.typecheck).toContain('tsconfig.worker.json')
    expect(pkg.scripts.deploy).toBe('npm run build && wrangler deploy')
    expect(pkg.scripts.deploy).not.toContain('-c ')
    expect(pkg.scripts['db:migrate:remote']).toBe('wrangler d1 migrations apply DB --remote')
    expect(pkg.engines.node).toBeDefined()
    expect(readFileSync('.node-version', 'utf8').trim()).toBe('22')
  })
})

describe('el Worker solo atiende /api/*; lo demás lo sirven los assets (fallback de rutas React)', () => {
  const app = createApp()
  it('las rutas de la aplicación NO pasan por la API', async () => {
    for (const p of ['/', '/colectivos', '/mapa', '/admin', '/admin/noticias', '/nuestro-pueblo', '/servicios/caps-rio-seco']) {
      expect(await app.handleApi(new Request(`https://app.test${p}`), {} as never), p).toBeNull()
    }
  })
  it('las funciones preparadas pero no activas están apagadas en producción', () => {
    expect(PRODUCTION_FEATURES).toEqual({ push: true, staticModules: false, syncSources: true, scheduledSync: true })
  })
})

describe('cabeceras de seguridad y recursos públicos', () => {
  const headers = readFileSync('public/_headers', 'utf8')
  it('define una política de contenido restrictiva (sin scripts en línea ni eval) que permite solo OpenStreetMap para imágenes', () => {
    const csp = headers.match(/Content-Security-Policy: (.+)/)![1]
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toMatch(/script-src[^;]*('unsafe-inline'|'unsafe-eval')/)
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain('img-src \'self\' data: https://tile.openstreetmap.org')
    expect(csp).toContain("connect-src 'self'")
    expect(headers).toContain('X-Content-Type-Options: nosniff')
    expect(headers).toContain('X-Frame-Options: DENY')
  })
  it('el panel no se guarda en caché ni se indexa', () => {
    expect(headers).toMatch(/\/admin\/\*\n\s+Cache-Control: no-store\n\s+X-Robots-Tag: noindex, nofollow/)
  })
  it('index.html no tiene scripts en línea (el tema se aplica desde un archivo propio)', () => {
    const html = readFileSync('index.html', 'utf8')
    expect(html).toContain('<script src="/theme-init.js"></script>')
    expect(html.replace(/<script[^>]*\bsrc=[^>]*><\/script>/g, '')).not.toMatch(/<script/)
    expect(existsSync('public/theme-init.js')).toBe(true)
  })
})

describe('higiene del repositorio', () => {
  it('.gitignore excluye secretos, copias de seguridad, entornos locales y artefactos', () => {
    const ignore = readFileSync('.gitignore', 'utf8')
    for (const p of ['.dev.vars', '.env', '.secrets/', 'backups/', 'node_modules', 'dist', 'dist-e2e', '.wrangler', 'playwright-report', 'test-results', '*.jwk']) expect(ignore, p).toContain(p)
  })
  it('ningún archivo versionado contiene claves privadas, tokens ni credenciales', () => {
    let files: string[]
    try {
      files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter((f) => f && !/package-lock|data-sources|\.(png|webp|jpe?g|ico|pdf)$/.test(f))
    } catch {
      return // sin Git disponible
    }
    const bad = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|"kty"\s*:\s*"EC"[^}]*"d"\s*:|xox[bp]-[0-9A-Za-z-]{10,}|EAAG[A-Za-z0-9]{40,})/
    for (const f of files) if (existsSync(f)) expect(readFileSync(f, 'utf8'), f).not.toMatch(bad)
    expect(files.some((f) => /^\.secrets\/|^backups\/|\.dev\.vars$|^\.env($|\.(?!e2e$))/.test(f))).toBe(false)
  })
})
