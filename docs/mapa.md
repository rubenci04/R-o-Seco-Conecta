# Mapa «Explorá Río Seco» (Sprint 03M)

## Tecnología y proveedor
- **Leaflet 1.9 + react-leaflet 5**, cargados de forma diferida (chunk `PlacesMap-*`, ~365 KB / 110 KB gzip, solo al entrar a `/mapa`).
- **Teselas: OpenStreetMap** (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`). Configuración en `src/config/map.ts`; se puede reemplazar sin tocar componentes con `VITE_MAP_TILES_URL`, `VITE_MAP_ATTRIBUTION` y `VITE_MAP_PROVIDER_NAME` al compilar.
- Sin Google Maps Platform, sin facturación. Los botones «Cómo llegar» abren una app de mapas externa por enlace (no usan API).

## Condiciones de OpenStreetMap que se respetan
([Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/))
- Atribución visible en el mapa y en «Acerca de» (© colaboradores de OpenStreetMap, ODbL).
- Sin descargas masivas, sin precarga del pueblo, sin mapas offline: el zoom está limitado a 13–18 y el área navegable al poblado más un margen (`TOWN.bounds`), de modo que cada visita solo pide las teselas de una vista.
- El service worker **no** guarda teselas ni precachea Leaflet (se prueba en `src/config/config.test.ts`); el código del mapa se guarda en caché solo después de usarse.
- El servicio público es de uso moderado y sin garantía de disponibilidad: si falla, la pantalla avisa y la lista de lugares, fichas y teléfonos siguen disponibles. Para tráfico alto habrá que pasar a un proveedor propio o contratado cambiando la configuración.
- Nominatim no se usa en la aplicación. Solo se hizo **una consulta manual** para ubicar la localidad (relación 9391561) y **una consulta Overpass** de investigación (ver abajo).

## Catálogo de lugares
`src/data/json/places.json` (esquema en `src/domain/community.ts`). Un lugar solo se coloca en el mapa si su `location` tiene coordenadas con **fuente** (elemento de OSM) y fecha de consulta. Si no, queda en su listado con `pending: ["location"]` y aparece en «Ubicación pendiente». Los datos de OSM son colaborativos: cada ficha lo aclara.
`scripts/places/build-catalog.mjs` documenta cómo se armó el catálogo inicial (consultado el 2026-10-28).

## Cómo agregar o corregir un lugar
1. Buscar el elemento en https://www.openstreetmap.org (o confirmar con la institución).
2. Cargar `location: { lat, lng, accuracy, source: { label, url, date } }` en `places.json`.
3. Quitar `location` de `pending`. `npm test` valida esquema, área, duplicados y coherencia.

## Transporte (preparado, sin datos inventados)
La capa «Transporte» existe y está vacía: no hay paradas verificadas. Futuras ampliaciones: paradas con coordenadas respaldadas (categoría `transporte`), correspondencia con `stopTimes` de los horarios y avisos de desvío. No se dibujan recorridos por deducción ni líneas rectas entre puntos. Las tablas de horarios no se modificaron.

## Rendimiento y accesibilidad
- En pantallas táctiles un dedo desplaza la página y dos dedos mueven el mapa (con aviso); hay controles de zoom y botón «Centro del pueblo».
- «Mi ubicación» solo se solicita al tocar el botón, no se guarda ni se envía.
- Marcadores enfocables con teclado, con nombre accesible; lista de lugares como alternativa en texto; enlace para saltar a la lista.

## Próximo sprint (D1)
`DataRepository.getPlaces()` ya aísla el origen de los datos: bastará una implementación respaldada por D1 (tabla `places` ya existe en `migrations/0002_editorial.sql`; faltaría agregar `lat`, `lng`, `accuracy` y la fuente de la ubicación).
