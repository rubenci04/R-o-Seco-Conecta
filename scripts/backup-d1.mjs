// Respaldo de la base D1 de producción en un archivo SQL local (carpeta backups/, fuera de Git: contiene datos y hashes de contraseñas).
//   npm run db:backup
// Restauración: ver docs/base-de-datos.md (D1 Time Travel permite volver atrás hasta 7 días atrás en el plan gratuito).
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

mkdirSync('backups', { recursive: true })
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)
const out = path.join('backups', `rio-seco-${stamp}.sql`)
execFileSync('npx', ['wrangler', 'd1', 'export', 'DB', '--remote', '--output', out], { stdio: 'inherit', shell: true })
console.log(`Respaldo guardado en ${out}`)
