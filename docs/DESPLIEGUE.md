# Despliegue (Cloudflare Workers Static Assets)

- Producción: https://rio-seco-conecta.rea-04.workers.dev
- Repositorio: https://github.com/rubenci04/R-o-Seco-Conecta (rama `main`)
- Configuración usada: `wrangler.jsonc` (solo assets estáticos de `./dist`, modo SPA, sin Worker dinámico, sin D1, sin secretos).
- `wrangler.worker.jsonc` es el backend del Sprint 02B: **no se usa** en el despliegue (solo con `-c wrangler.worker.jsonc`).

## Despliegue manual
```bash
npm run build
npx wrangler deploy
```

## Despliegue automático (Workers Builds, integración nativa)
Se configura una sola vez en el panel de Cloudflare (requiere autorizar la app de GitHub):

1. Cloudflare Dashboard → **Workers & Pages** → **rio-seco-conecta** → **Settings** → **Builds** → **Connect**.
2. Elegir **GitHub**, autorizar la app «Cloudflare Workers & Pages» y seleccionar el repositorio `rubenci04/R-o-Seco-Conecta`.
3. Rama de producción: `main`. Directorio raíz: `/` (donde está `package.json`).
4. Comando de build: `npm run build`. Comando de despliegue: `npx wrangler deploy`.
5. Guardar. El nombre del Worker en Cloudflare debe ser `rio-seco-conecta` (coincide con `wrangler.jsonc`).
6. Probar con un push a `main` y revisar **Builds** → historial.

No usar a la vez GitHub Actions para desplegar: duplicaría las publicaciones. Node se fija en `.node-version` (22).

## Cachés de la PWA
Los íconos y el logo llevan sufijo de versión (`-v2`). Para cambiarlos: reemplazar `src/logo.png`, subir `V` en `scripts/brand/build-assets.ts` y en `pwa/pwa.config.ts`/`index.html`, y ejecutar `npm run brand:build`. El service worker se actualiza solo (`registerType: autoUpdate`).

> Última verificación del despliegue automático: push de prueba a `main` (Workers Builds).
