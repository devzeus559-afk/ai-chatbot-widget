# Feature: report_pounds_shipped — presupuesto de sentencias (opción B)

**Feature ID**: `pounds-shipped-statement-budget`
**Rama**: `develop`
**Estado**: in progress

## Objetivo

Que `report_pounds_shipped` ("cuántas libras se enviaron…") devuelva datos para
consultas **reales** (sin filtro de oficina, mes completo, oficinas grandes), en
vez de morir por límite de sentencias de Deluge.

## Problema

Solo funcionaba la consulta más chica: "libras desde Elizabeth este mes"
(554 paquetes). El resto fallaba con *"Number of statement execution limit
exceed"* y el registro `ChatRequests` quedaba huérfano (`Status: null`).

## Causa raíz (medida por lectura de código)

Costo por registro ≈ **69–73 sentencias**, contra un techo medido de **40.000**:

| Etapa | Sentencias/registro |
|---|---|
| `materialize_package_report` (11 puts + reads + 2 lookups + guards) | ~30–34 |
| Agregación del tool (**3 maps independientes**) | ~39 |

Breakpoint: `(40.000 − overhead) / 70 ≈ 500–630 paquetes`. Los 554 de Elizabeth
entraron raspando; cualquier cohorte mayor muere.

**Agravante**: el tope declarado (`maxBatches = 25` → 5.000 paquetes) y
`report_scan_truncated` (`>= 5000`) son **inalcanzables** — nunca se llega a
degradar con `truncated: true`, la ejecución simplemente revienta.

## Alcance autorizado (opción B)

- `deluge/core/data_access.deluge`: agregador streaming nuevo + constante de tope.
- `deluge/tools/tool_report_pounds_shipped.deluge`: consumir el agregador.
- `chatbot-widget/app/js/creator-api.js`: corregir el mensaje genérico del widget.

**Fuera de alcance (solo reportado, no implementado)**:
- Filtros por mercancía/clase en este tool (hoy no existen).
- Params muertos `country`/`measure` en el `paramSchema` de Zia.
- Los 4 tools hermanos que comparten el fetcher caro.
- Precompute por Schedule (opción C).

## Enfoque (B1 + B2 + B3)

- **B1** — una sola pasada: el agregador actualiza acumuladores **mientras**
  recorre los lotes; no se construye la lista intermedia de ~2.000 maps.
- **B2** — no se materializa el shape completo; solo se leen los campos que el
  reporte usa (`Total_Weight`, `Office`, `Package_Type`, `Shipment_Type`).
- **B3** — **un** map con clave compuesta `oficina|tipo|clase`, y al final se
  parte en los 3 desgloses. De 3 actualizaciones de map por registro a 1.

Resultado esperado: ~70 → ~20 sentencias/registro → cubre el volumen mensual real.

## Tareas

- [x] T1. Agregador streaming `aggregate_pounds_by_window_office()` + `pounds_scan_batches()`
- [x] T2. Reescribir `tool_report_pounds_shipped` sobre el agregador (contrato de salida idéntico)
- [x] T3. Corregir el mensaje genérico del widget (no aplica "top más pequeño" a un reporte)
- [ ] T4. Verificación manual en Creator (pendiente del usuario)
- [ ] T5. Calibrar `pounds_scan_batches()` con el resultado real de T4

## Verificación

No hay runner local (Deluge corre solo en Creator). Verificación = revisión
estática del diff + pasos manuales en Creator:

1. `node tools/creator-parity.js` → `drift: none`.
2. En Creator: "cuántas libras se enviaron este mes" (sin oficina).
   - Esperado: datos reales, sin mensaje de límite.
3. "cuántas libras desde Elizabeth este mes" → mismo total que antes (554 paquetes,
   comparar cifra contra la corrida previa).
4. "cuántas libras desde Miami este mes" (oficina grande).
5. `ChatRequests` del caso 3: `Status = answered` y `Reply` con el reporte.

## Riesgos

- La estimación de ~20 sentencias/registro es analítica, no medida en vivo. Si el
  caso 2 falla, bajar `pounds_scan_batches()` (T5).
- El tope sigue existiendo: trimestres/años pueden truncar (`truncated: true`).
  La vía definitiva es precompute (opción C).

## Ruta de implementación

**Direct inline** — 3 archivos, diseño ya resuelto y delimitado. Los subagentes
de exploración fallan en este entorno (free tier de OpenCode), restricción ya
registrada del proyecto.
