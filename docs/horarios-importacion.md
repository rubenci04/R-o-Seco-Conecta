# Importación de horarios de colectivos

Fuente: <https://colectivostucuman.com.ar/> (horarios de boleterías, planillas y relevamiento presencial; procedencia declarada por el responsable del proyecto).
Alcance: las 40 páginas `/horarios/{origen}/{destino}` del sitemap que tienen **Río Seco como origen o destino**. `robots.txt` solo veda `/admincompany/` y `/login/`; el importador no toca esas rutas, pide 1 página cada 1,5 s con un User-Agent identificado y no usa sesiones ni cookies.

## Cómo se obtienen los datos
Cada página publica en su HTML las propiedades del buscador (rutas, paradas, viajes con tipo de día y marca de horario estimado) y los totales que muestra en texto. El importador las lee tal cual; **no interpola ni deduce horarios**.

```bash
npm run schedules:fetch    # (opcional, usa red) descarga y guarda instantáneas en data-sources/colectivostucuman/
npm run schedules:import   # (sin red) instantáneas → src/data/json/schedules.json + IMPORT_REPORT.json
npm test                   # verifica cantidades, reproducibilidad y reglas
```

`schedules:import` termina con error si alguna cantidad importada no coincide con el total que declara la página.

## Reglas aplicadas
- `~` delante de la hora = **aproximado** (el colectivo para en Río Seco aunque no figura en la grilla oficial). Se conserva como `precision: "approximate"`.
- Madrugada (00:00–03:59) = día operativo anterior: se guarda `00:10` y la app lo interpreta como `24:10` del día de servicio.
- «Domingos y feriados» es un único cuadro en la fuente: los feriados usan los horarios de domingo.
- Paradas sin hora informada = `null` (p. ej. Santa Lucía, Cáceres y Sargento Moya en el servicio común a Concepción).
- Las rutas que la fuente define **sin ningún viaje** quedan «sin datos»: no se inventan servicios directos ni combinaciones.
- Duración = llegada − salida de los datos de la fuente (cálculo, no un dato nuevo).

## Resultado
Ver `data-sources/colectivostucuman/IMPORT_REPORT.json`. Totales: **835** servicios hábiles, **532** de sábado y **532** de domingo/feriado (40 páginas, dos sentidos). Cada servicio conserva empresa, tipo, origen/destino con su parada, salida, llegada, duración, observaciones, URL de la página y fecha de la consulta.

## Discrepancia «46 vs 45» (Río Seco → Concepción, días hábiles)
La página declara 46 salidas y su FAQ enumera 45 horarios. Los registros reales contienen **dos servicios distintos a las 13:30** (común por Plaza, llega 13:45; semirrápido aproximado por Terminal, llega 13:40). La FAQ lista horas distintas, así que colapsa los dos en uno. Resultado: **46 servicios reales**, sin agregar ni quitar ninguno. Hay diferencias análogas (todas explicadas por salidas repetidas) en: Concepción → Río Seco (15:25), Famaillá → Río Seco (12:45) y San Miguel → Río Seco (11:45 y 23:00).

## Procedencia y autorización
El responsable del proyecto indicó que los datos provienen de fotografías de boleterías, planillas Excel y relevamiento presencial, y que corresponde reutilizarlos. Queda registrado como `reuseAuthorized: true`. Recomendación: dejar constancia escrita con el autor del sitio y, si existe, incorporar la planilla original como fuente primaria.
