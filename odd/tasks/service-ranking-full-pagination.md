# Feature: service-ranking-full-pagination — ranking exacto (paginado) para los reportes de top-clientes

## Objetivo
Que los tres reportes de ranking sobre `Service` (`report_top_customers`, `report_top_package_customers`, `report_top_remittance_customers`) agreguen **todos** los servicios de la ventana, no una muestra arbitraria de 200. Hoy el "sin filtros" devuelve máximos MENORES que un resultado por oficina, porque cada consulta trunca un pool distinto.

## Problema (verificado en live)
El usuario pidió el top de paquetería sin filtros → máximo 2 paquetes. Por oficina: Elizabeth → 3, West New York → 5. Imposible si miraran el mismo universo.

Causa raíz (código):
- `data_access.fetch_services_report_by_ids` (L891) y `fetch_services_by_ids` (L574) hacen `Service[ID in ids] sort by Service_ID range from 0 to 199` — recorte duro de 200 sobre un orden **arbitrario** (`Service_ID`, un id de negocio, no por fecha).
- Los tools comparan luego totales de pools de distinto tamaño: el "sin filtros" sale de un pool grande y truncado; una oficina con <200 servicios entra completa. Por eso el ranking por oficina puede "superar" al global: no es contradicción aritmética, son dos muestras distintas.
- La nota "se analizaron los primeros 200 servicios" admite el problema, pero el recorte es además arbitrario (por `Service_ID`, no por recencia).

## Por qué (decisión del usuario)
El usuario pidió "el arreglo correcto, con paginado": recorrer la cohorte completa en lotes de 200 (como ya hacen los reportes de paquetes) para que el ranking sea exacto y comparable entre filtros.

## Alcance
- `data_access.deluge`: nueva `fetch_all_services_report_by_ids(list ids)` — paginada con cursor `ID > lastId`, lista contadora (Deluge no tiene `while`), materializa por lote reutilizando `materialize_service_report` (cero duplicación de mapping).
- `tool_report_top_package_customers.deluge`, `tool_report_top_remittance_customers.deluge`: parámetro `full` (default `true`); `true` → paginado completo, `false` → path acotado de 200 actual. `truncated` vía `report_scan_truncated(records, fullFlag)`.
- `tool_report_top_customers.deluge`: idem, y **unifica la fuente**: pasa de `fetch_services_by_ids` (shape rico) a la pareja `fetch_services_report_by_ids` / `fetch_all_services_report_by_ids`. Verificado que el tool solo consume `customerId`, `date`, `serviceType` de cada fila (los nombres vienen de `fetch_contacts_by_ids` aparte), así que la shape del reporte alcanza.
- `chat_common.deluge`: corregir el texto de la nota (L427/L464/L486) para no afirmar "los primeros 200" cuando el path completo puede haber truncado a 5000.

## Restricciones
- **Deluge NO soporta `while`** → lista contadora `leftpad(...).replaceAll(" ","1,").toList(",")` + `for each` + `break`.
- **`for each` exige DOS espacios** (`for each  x in y`); con uno el live tira Improper Statement.
- Cursor sobre `ID` (no `Service_ID`): `Service[ID in ids && ID > lastId] sort by ID range from 0 to 199`. `&&` con `ID in ids` ya se usa en el repo (L301).
- `recBatch.count()` para colecciones crudas; `.size()` solo para List/Map en memoria (el materializador devuelve List<Map> → `.size()`).
- `maxBatches = 25` (tope duro 5000), consistente con `fetch_all_packages_by_window_office`. Materializar por lote (no todo junto) por el timeout de 40s.
- `prefetch_service_refs()` se llama UNA vez por invocación, fuera del loop.
- Comentarios en español (consistente con `deluge/`).
- No tocar `creatorapp-backup/*.ds`, `package-lock.json`, `.gga`.

## Checklist

- [x] T1: Doc de feature + espejo en Engram (`odd/service-ranking-full-pagination/tasks`)
- [x] T2: `data_access.deluge` — `fetch_all_services_report_by_ids(ids)` paginada
- [x] T3: `tool_report_top_package_customers.deluge` — param `full` + branch + `report_scan_truncated`
- [x] T4: `tool_report_top_remittance_customers.deluge` — idem
- [x] T5: `tool_report_top_customers.deluge` — idem + unificar fuente a la shape del reporte
- [x] T6: `chat_common.deluge` — nota honesta (3 sitios) + `(truncado a 200)`→`(truncado)` en el summary genérico
- [x] T7: `tests_report_top_customers.deluge` — test de cap al nuevo contrato (acotado vs full)
- [x] T9: `chat_intent.scan_report_tools()` — sumar los 3 rankings sobre `Service` (la lista los excluía con un comentario ya falso)
- [x] T10: `chat_config.deluge` — documentar `full` en las descripciones de los 3 tools (ripple del catálogo)
- [x] T11: `README.md` + `METRICS.md` — reemplazar la doc del cap 200 por el contrato full/rápida
- [x] T8: Verificación estática + `node tools/creator-parity.js` + commit `425678b` (develop; sin push)

## Verificación
- Estático: balance de llaves/paréntesis, firma de cada `thisapp.chat_*` contra su definición, `for each` con DOS espacios en el loop nuevo.
  - Balance: `data_access` 206/206, `tool_report_top_*` 77/77, 71/71, 56/56, `chat_common` 238/238, `tests_report_top_customers` 67/67 — todos OK. `chat_intent` 296/295 y 658/667 es un desbalance PRE-EXISTENTE (idéntico en HEAD: 296/295 y 653/662) causado por literales JSON (`{"tool","params"}`); mi edición sumó +5/+5 (los 5 `tools.add(...)`) → neutral.
  - Espaciado `for each`: 15 ocurrencias de un espacio, TODAS pre-existentes; el loop nuevo usa dos espacios (espejo del precedente `fetch_all_packages_by_window_office`).
- `node tools/creator-parity.js --json` → `missingInLive: 1` (`chat_data_access.fetch_all_services_report_by_ids`), `differentInLive: 9` (3 `chat_common.format_top_*`, `fetch_all_packages_by_window_office`, `chat_invoke.dispatch_tool`, los 3 `chat_tools.report_top_*`, `tests_report_top_customers.test_cap_200_truncated`). `unknownReturnTypes: 0`. Baseline previo: drift 2; el delta es exactamente lo tocado. Todo pendiente de deploy.
- Manual en Creator (pendiente de deploy): pedir top de paquetería sin filtros y por oficina → los máximos del global deben ser ≥ a los de cada oficina; la nota "aproximado" NO debe aparecer en el path completo con <5000 servicios; "vista rápida" debe volver al path acotado.

## Decisiones (notables)
- **Una sola función paginada sirve a los tres tools**, porque la shape de `fetch_services_report_by_ids` ({serviceType,zid,customerId,date,amount,totalWeight,officeName}) contiene las claves que los tres consumen. Evita duplicar el mapping rico de `fetch_services_by_ids`.
- **`fetch_services_by_ids` queda sin uso** tras T5 (solo lo llamaba `top_customers`). Se deja en su lugar; su borrado es un follow-up, no parte de este cambio.
- **`report_scan_truncated(records, fullFlag)` se reutiliza tal cual** (comentario L1083: "única fuente de verdad del flag truncated"). Edge conocido: `total == 5000` exacto marcaría truncated=true aunque esté completo (off-by-one heredado de los tools de paquetes).
- **`full` default `true`**: el chat/UI no envía el param; el path completo es el comportamiento normal. `full:false`/`"false"` fuerza el path acotado (para tests/manual).
- **`chat_intent.apply_report_scan_mode` ya existía y ya inyectaba `full:true`** para los "scan reports" (patrón c01037f). Pero `scan_report_tools()` EXCLUÍA a los 3 rankings sobre `Service` con el comentario "NO consumen el flag: aggregate sobre otros módulos" — falso: agregan sobre `Service`, igual que los de paquetes sobre `Package`. Estaban half-wired: el intent mandaba `full` y el tool lo ignoraba. T9 los suma; el `default true` del tool es la red de seguridad para el path de `Route_Hint` (que puede saltear `chat_intent`).
- **README estaba doblemente mal**: decía "se analizan los primeros 200 por fecha de negocio", pero el recorte era por `Service_ID` (orden arbitrario, no fecha) y encima el default no era 200. Corregido.
- **`for each` con DOS espacios no es una regla universal**: hay 15 ocurrencias de UN espacio que funcionan en producción. El precedente paginado (`fetch_all_packages_by_window_office`) usa dos y su comentario registra un `Improper Statement` en vivo con uno; el loop nuevo lo copia byte a byte. Tratar como cosmético/heredado, no como regla dura.
- **`fetch_services_by_ids` queda sin callers** tras T5 (era exclusiva de `top_customers`); su borrado es follow-up. `fetch_services_report_by_date_window` ya estaba sin callers antes de este cambio.
