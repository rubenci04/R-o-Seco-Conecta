# Río Seco Conecta

PWA informativa e independiente para vecinos de Río Seco, Tucumán. **No es una aplicación oficial de la Comuna.**
Sprint 01: React + Vite + TypeScript, Tailwind v4, componentes estilo shadcn/ui, PWA, datos JSON validados con Zod.

## Ejecutar localmente
```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # lint + typecheck + tests + build
npm run test:e2e   # Playwright (requiere: npx playwright install)
npm run icons      # regenera los íconos de la PWA
```

## Arquitectura
| Carpeta | Responsabilidad |
|---|---|
| `src/components/{ui,layout,shared,transport,content}` | Componentes visuales |
| `src/pages` | Pantallas |
| `src/domain` | Esquemas Zod y tipos |
| `src/data` | JSON locales + `DataRepository` (sustituible por Cloudflare D1) |
| `src/features/transport` | Lógica pura: tipo de día, próximo colectivo, medianoche, consulta en URL |
| `src/services` | Favoritos, compartir, tema, reloj |
| `src/config` | Registro central de enlaces (`links.ts`), navegación, app |
| `pwa/` | Configuración PWA (manifiesto, workbox) |

## Sprint 02A
- Horarios reales de colectivos importados (ver `docs/horarios-importacion.md`): `npm run schedules:import`.
- Identidad celeste/blanca/naranja derivada del logo: `npm run brand:build` regenera favicon e íconos PWA desde `src/logo.png` (fondo transparente automático, nombres con sufijo de versión contra cachés) y la portada desde `src/rio seco.jpeg`.
- Secciones **Nuestro pueblo** (`src/data/json/heritage.json`) y **Servicios y lugares útiles** (`places.json`, `emergency.json`): datos estructurados y editables, con estado documentado / aporte del equipo / pendiente.
- Trabajo adelantado del Sprint 02B (D1, API, sincronización, notificaciones), **sin conectar a la app ni desplegar**: carpetas `migrations/`, `worker/`, `shared/`, config `wrangler.worker.jsonc`.

## Sprint 03M
- Mapa interactivo **Explorá Río Seco** (`/mapa`): Leaflet + OpenStreetMap, carga diferida, capas por categoría compartibles por URL, ficha por lugar (`/servicios/:id`). Ver `docs/mapa.md`.

## Sprint 04 — contenido dinámico y panel
- Worker único (PWA + API sobre D1) y panel privado `/admin`: noticias, alertas, agenda y obituarios sin editar JSON ni redesplegar. Ver `docs/panel-administracion.md`, `docs/base-de-datos.md` y `docs/DESPLIEGUE.md`.
- Repositorio híbrido: lo dinámico viene de la API; horarios, mapa, lugares, Nuestro pueblo y radios siguen en JSON validado.
- Facebook/Instagram y Web Push: preparados, **no activos** (faltan credenciales y permisos).

## Datos y reglas editoriales
- No se inventa contenido: `news/alerts/events/obituaries.json` están vacíos hasta tener fuentes verificadas.
- `schedules.json` (generado, no editar a mano) contiene solo horarios con fuente y `reuseAuthorized: true`. Horas ≥ 24:00 (ej. `24:15`) indican servicios posteriores a la medianoche.
- Datos sintéticos únicamente en `src/test/fixtures.ts`.
- Feriados: `holidays.json` incluye solo los de fecha fija (MM-DD). Los trasladables se agregan por año con fecha completa AAAA-MM-DD.

## GitHub y Cloudflare
Ver `docs/DESPLIEGUE.md`.
