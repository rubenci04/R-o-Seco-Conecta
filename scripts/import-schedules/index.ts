/**
 * Paso 2 (sin red): lee las instantáneas de data-sources/colectivostucuman/, valida y escribe
 *   - src/data/json/schedules.json                    (dataset que consume la app)
 *   - data-sources/colectivostucuman/IMPORT_REPORT.json (cantidades y discrepancias)
 * Uso:  node scripts/import-schedules/index.ts      (o `npm run schedules:import`)
 * Para actualizar desde la fuente primero:  node scripts/import-schedules/fetch.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { PageSnapshot } from './extract.ts'
import { buildDataset, buildReport } from './normalize.ts'

const DIR = path.resolve('data-sources/colectivostucuman')
const snapshots = readdirSync(DIR)
  .filter((f) => f.endsWith('.json') && f !== 'IMPORT_REPORT.json')
  .map((f) => JSON.parse(readFileSync(path.join(DIR, f), 'utf8')) as PageSnapshot)

const dataset = buildDataset(snapshots)
const report = buildReport(dataset)

writeFileSync(path.resolve('src/data/json/schedules.json'), `${JSON.stringify(dataset)}\n`)
writeFileSync(path.join(DIR, 'IMPORT_REPORT.json'), `${JSON.stringify(report, null, 2)}\n`)

const t = report.totalServices
console.log(`Páginas: ${report.pagesImported} · servicios importados: hábil ${t.weekday}, sábado ${t.saturday}, domingo/feriado ${t.sunday}`)
console.log(`Rutas definidas sin servicios: ${report.routesWithoutServices.length ? report.routesWithoutServices.join('; ') : 'ninguna'}`)
if (report.mismatches.length) {
  console.error('DISCREPANCIAS:\n- ' + report.mismatches.join('\n- '))
  process.exitCode = 1
} else console.log('Cantidades verificadas contra los totales declarados por la fuente.')
