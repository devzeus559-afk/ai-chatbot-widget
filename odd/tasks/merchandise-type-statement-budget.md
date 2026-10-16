# Feature: merchandise-type statement budget

## Objetivo

Que `report_merchandise_type` funcione con volumen real (deje de morir con
"Number of statement execution limit exceed") y que acepte rango de fechas, no
solo una ventana fija de 30 días.

## Problema

`report_merchandise_type` es la métrica que responde "estadística por tipo de
mercancía". Hoy usa el mismo camino caro que tenía `report_pounds_shipped`:

- `fetch_all_packages_by_window_office` → `materialize_package_report`
  (~30-34 sentencias/registro) + un loop de agregación (~8-10) ≈ **40-45 por
  registro** (estimado, no medido).
- Breakpoint estimado **~1.000-1.100 paquetes**, contra ~1.500 mensuales reales
  → muere en un mes cargado.
- Su `truncated` viene de `report_scan_truncated(records, fullFlag)`, que compara
  contra **5000** fijo: un tope inalcanzable. Es el mismo defecto de honestidad
  que ya corregimos en libras (la ejecución muere antes de degradar).
- **Ventana clavada en 30 días**: el catálogo solo anuncia `limit` y `office`. No
  se puede pedir "el mes pasado" ni un trimestre.

## Por qué

El usuario reportó que el reporte de libras ya anda sin filtros y pidió la
estadística por tipo de mercancía con rango de fechas. Sin esto, la métrica
existe en el catálogo pero falla en producción con volumen real.

## Alcance

Dentro:
- Agregador streaming nuevo para mercancía (mismo patrón que el de libras).
- Tope calibrado contra el techo medido de 40.000 sentencias.
- Fechas: `startDate`/`endDate` en el tool + `period` (enum) en el catálogo,
  resuelto por `chat_invoke` como el resto de las métricas.
- `truncated` honesto, derivado del tope real.
- Formateador: mostrar el período real (hoy dice "últimos 30 días" hardcodeado)
  y avisar cuando el resultado es parcial.

Fuera (explícito, no autorizado):
- El cruce "libras por tipo de mercancía" (dimensión nueva, no pedida).
- Cambiar la salida por paquetes a libras.
- Tocar los otros tools que comparten `fetch_all_packages_by_window_office`
  (`report_shipping_type_frequency`, `report_monthly_comparison`,
  `report_daily_average`). Quedan como deuda conocida.

## Restricciones

- Deluge: `Form[criteriaVar]` inválido; el filtro va con literal de campo y
  cursor de ID.
- `for each` exige **dos** espacios.
- Techo medido de la cuenta: **40.000 sentencias** (`deluge/METRICS.md`). El
  presupuesto se comparte con `chat_invoke` (sesión, historial, Zia, formateo).
- Sin runner local: la verificación es lectura estática + prueba manual en Creator.
- `params` de fechas llegan como **string ISO** desde `chat_invoke`
  (`datePair.get(0).toString("yyyy-MM-dd")`); el tool usa el patrón
  `sd != ""` + `toDate("" + sd)`.

## Tareas

Ruta por tarea: **inline** (restricción registrada del entorno: sin subagentes en
free tier). Trigger de delegación que aplicaría y por qué no dispara: son 5
archivos, pero el conjunto es el mismo cambio coherente y ya explorado en la
sesión previa; un writer delegado no reduce riesgo acá.

- [x] **T1** — `data_access`: `merchandise_scan_batches()` (tope calibrado) y
      `aggregate_packages_by_merchandise(startDate,endDate,officeZid,maxBatches)`.
      Una sola pasada, sin lista intermedia, `truncated` honesto.
- [x] **T2** — `tool_report_merchandise_type`: consumir el agregador; leer
      `startDate`/`endDate` (default últimos 30 días); preservar el contrato de
      salida (`merchandise: [{name, packageCount, sharePct}]`).
- [x] **T3** — `chat_config`: `paramSchema` y descripción con `period` +
      `startDate`/`endDate` (que Zia sepa que puede pedirlos).
- [x] **T4** — `chat_common.format_merchandise_type`: mostrar el período real y
      el aviso de resultado parcial.
- [ ] **T5** — Commits por unidad de trabajo + parity + doc de verificación manual.

## Progreso

Implementado y commiteado en `develop`. **Verificación en Creator pendiente**.

Hallazgo de diseño (importante): no hizo falta inventar el mecanismo de fechas.
`chat_invoke` ya resuelve el enum `period` → `startDate`/`endDate` (string ISO)
antes del dispatch, de forma **genérica para todas las tools**. El tool solo lee
fechas; lo que faltaba era anunciar `period` en el `paramSchema` del catálogo.

Decisiones:
- `periodLabel` se pre-formatea en el **tool**, no en el formateador, siguiendo
  el precedente `monthLabel` de `report_monthly_comparison`: en el tool las
  fechas son tipo `date` con certeza, así que `toString(formato)` es seguro sin
  chequeo de tipo.
- Parseo de fechas defensivo en el tool: una fecha ilegible cae al default en vez
  de mandar `null` al agregador (los tools hermanos no lo hacían).
- Tope `merchandise_scan_batches()` = 10 (2.000 paquetes), más conservador que el
  de libras (8) porque el prefetch de Shipment pesa relativamente más acá.
- `counts` y `names` van como dos maps paralelos: mantiene el costo por registro
  bajo (~11-12) y preserva el nombre crudo que publicaba el materializador.

Verificación estática hecha: llaves balanceadas en los 4 archivos; ningún
`for each` con un solo espacio agregado por este cambio.

Commits de la unidad de trabajo (`develop`):

| Commit | Qué |
|---|---|
| `b1bce2d` | `docs(odd)` — este documento |
| `c8ce49f` | `perf(merchandise)` — agregador streaming + rango de fechas |
| `5f04e39` | `feat(config)` — `period`/`startDate`/`endDate` en el catálogo |
| `c33c9ab` | `feat(format)` — período real + aviso parcial |

`node tools/creator-parity.js` → `drift: true`, `parity: 212/221`. Drift esperado
(el live todavía no tiene el código): 4 funciones nuevas en `data_access` (2 de
libras + 2 de mercancía) y 5 cuerpos distintos (`chat_config.chat_config`,
`chat_common.format_pounds_shipped`, `chat_common.format_merchandise_type`,
`chat_tools.report_pounds_shipped`, `chat_tools.report_merchandise_type`).

Deploy pendiente en Creator, en este orden: `data_access` → `chat_config` y
`chat_common` → las dos tools.

## Criterios de aceptación

1. "estadística por tipo de mercancía" (sin filtros, mes corriente) devuelve
   datos y `ChatRequests.Status = answered`.
2. "tipo de mercancía del mes pasado" respeta el período (no 30 días fijos).
3. El aviso de parcial solo aparece cuando el escaneo tocó el tope.
4. El contrato de salida no cambió: el formateador y el widget no se tocan por
   estructura, solo por el texto del aviso.
5. `node tools/creator-parity.js` sin drift tras el deploy.

## Verificación (manual, en Creator)

- `report_merchandise_type` sin params → datos del último mes.
- Con `period: "mes_anterior"` → período anterior.
- Con `office` inválida → "Oficina no encontrada".
- Con volumen grande → o datos, o aviso de parcial; nunca el cartel de límite.

## Presupuesto y riesgo

- Costo objetivo: ~11-12 sentencias/registro (vs ~40-45 hoy).
- Tope: 10 lotes = 2.000 paquetes ≈ 22.000-24.000 sentencias; deja margen al
  resto de `chat_invoke`.
- Riesgo principal: que el conteo por registro esté subestimado. Mitigación: el
  tope es un único número documentado (`merchandise_scan_batches`) y bajarlo es
  un cambio de una línea.
- Rollback: revertir el commit; los tools viejos siguen en `git` y el
  `.ds`/Creator conserva la versión previa hasta el próximo paste.
