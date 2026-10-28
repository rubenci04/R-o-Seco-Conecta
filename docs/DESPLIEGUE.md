# Despliegue (Cloudflare Workers: PWA + API sobre D1)

- Producción: https://rio-seco-conecta.rea-04.workers.dev
- Repositorio: https://github.com/rubenci04/R-o-Seco-Conecta (rama `main`)
- **Un solo Worker** (`rio-seco-conecta`) definido en `wrangler.jsonc`: assets de la PWA (`./dist`, fallback SPA) + código del Worker (`worker/index.ts`, solo atiende `/api/*`) + base D1 `DB`.
- `wrangler.static.jsonc` es un **respaldo de emergencia** (solo assets estáticos). Para volver al modo estático: `npx wrangler deploy -c wrangler.static.jsonc` — y además poner `VITE_DATA_MODE=local` al compilar, porque el frontend de producción lee noticias/alertas/agenda/obituarios de la API.
- Sin cron, sin secretos y sin variables en la configuración actual.

## Despliegue automático (Workers Builds)
Configurado en el panel de Cloudflare (Workers & Pages → `rio-seco-conecta` → Settings → Builds): rama `main`, build `npm run build`, deploy `npx wrangler deploy`, raíz `/`. Como `wrangler.jsonc` ya es el dinámico, **cada push a `main` publica la versión con API**. No usar GitHub Actions a la vez.

Antes de un push que incluya una migración nueva:
```bash
npm run db:backup && npm run db:migrate:remote
```

## Despliegue manual
```bash
npm run build && npx wrangler deploy
```

## Verificaciones recomendadas tras publicar
`/api/health` devuelve `database: ok` · `/api/admin/users` sin sesión → 401 · `/radios` y `/api/public/radios` (no existe, 404) · rutas React directas (`/mapa`, `/admin`) → 200 · el panel permite iniciar sesión.

## Cachés de la PWA
Íconos y logo con sufijo de versión (`-v2`); el service worker se actualiza solo. Para cambiar el logo: reemplazar `src/logo.png`, subir `V` en `scripts/brand/build-assets.ts`, `pwa/pwa.config.ts` e `index.html`, y ejecutar `npm run brand:build`. El código del mapa y del panel no se precachean; `/api/public/*` usa «red primero» con respaldo de 24 h; `/api/admin/*` nunca se guarda.

## Plan gratuito: límites y consumo estimado
Workers (gratis): 100 000 solicitudes/día al código del Worker (solo la API cuenta; los assets estáticos no). D1 (gratis): 5 M filas leídas/día, 100 000 escritas/día, 5 GB. Con el tráfico de un pueblo (cientos de visitas/día, ~5 llamadas de API por visita, una consulta por llamada) el consumo es una fracción mínima. Las respuestas públicas usan ETag (304 sin cuerpo si no cambió). Sin cron no hay consumo en segundo plano.
