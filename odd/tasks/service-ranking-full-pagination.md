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

---

## PIVOT (2026-10-14) — la causa raíz no era la muestra ni el tiempo: era el techo de sentencias

El "ranking exacto" **falló en vivo** (el widget mostró *"La solicitud tardó demasiado (45 s)"*), y
el `addRecord` devolvió `Data Added Successfully` **con** `error: [... Number of statement
execution limit exceed Line:(24)]`. Diagnóstico corregido:

- **No es un timeout de tiempo.** Es el límite de **sentencias ejecutadas** de Deluge (~5000 en el
  plan base; plan-dependent). Cada vuelta de un `for each` vuelve a multiplicar el cuerpo.
- La cadena causal cierra los dos síntomas: el presupuesto se agota DENTRO de `chat_invoke` → el
  `catch` de `on_submit_chatrequests.deluge` no alcanza a persistir `input.Status="failed"` (la
  línea 24, la que reporta el error, es la última del catch) → el `ChatRequest` queda `pending` para
  siempre → el widget pollea 24 veces y muestra su cartel a los 45 s.
- Costo medido: `materialize_service_report` ≈ 20 sentencias/registro y el loop de agregación de
  cada tool ≈ 15-20 más → **~40 por registro**. Con miles de servicios no entra en ningún
  presupuesto síncrono. Explica por qué el path acotado a 200 andaba y el completo no.
- **Error propio reconocido:** el troceo en memoria del intento anterior iteraba TODOS los ids
  (~3 sentencias por id = 3N) mientras el cursor gasta una cantidad FIJA por lote; se optimizó
  round-trips y se **empeoró** el conteo de sentencias. Eje equivocado. La única mejora real de ese
  intento fue eliminar `prefetch_service_refs` (~10 queries y ~1400 registros que nadie leía).

### Decisión del usuario: "optimizar y acotar"
Mantener el ranking síncrono, bajar el costo por registro, poner un tope explícito y declarar
`truncated` con honestidad. Descartado (por ahora): precalcular por función programada (Schedule),
que es la única vía de ser **exacto** a escala.

### Checklist del pivot
- [x] T12: `data_access.materialize_service_report` — shape LEAN (se quitan `zid` y el bloque
      completo de `officeName`; ningún tool de ranking los lee) → ~20 → ~11 sentencias/registro.
      Firma pasa de `(Service records, map officeById)` a `(Service records)`; callers actualizados.
- [x] T13: `data_access.fetch_all_services_report_by_ids` — se reemplaza el troceo en memoria (3N)
      por el **cursor** del precedente de paquetes (`ID > lastId`, lotes de 200, costo fijo por
      lote) **acotado al tope**.
- [x] T14: `data_access.service_scan_batches()` + `service_scan_truncated()` — tope en UN solo
      lugar (`2` lotes = 400 servicios) y flag `truncated` propio del path de servicios (no se toca
      `report_scan_truncated`, compartido con paquetes, cuyo tope sigue siendo 5000).
- [x] T15: los 3 tools de ranking — `report_scan_truncated` → `service_scan_truncated`; docstrings y
      el comentario falso "ranking exacto sobre TODA la ventana" corregidos.
- [x] T16: `tests_report_top_customers` — el assert del path completo pasa de `>=5000` a leer el
      tope del helper (`service_scan_batches() * 200`), así no se desincroniza al subirlo.
- [x] T17: `README.md` + `METRICS.md` — documentar el techo de sentencias, el tope de 400 y la
      **sonda** para medir el techo real de la cuenta (`METRICS.md`).

### Verificación del pivot
- Balance de llaves/paréntesis: **delta 0** contra HEAD en los 5 `.deluge` tocados
  (`data_access` 208/208 y 663/663, los 3 tools 71/71, 77/77, 56/56, `tests_report_top_customers`
  67/67 y 280/280). Sin `while(`; sin refs de 2 args a `materialize_service_report`; sin
  `report_scan_truncated` en los 3 rankings.
- `node tools/creator-parity.js --json` → `parity 208`; `missingInLive`: `service_scan_batches`,
  `service_scan_truncated` (nuevas); `differentInLive`: exactamente las 7 funciones tocadas +
  `test_cap_200_truncated`. `unknownReturnTypes: []` (los tipos `int`/`boolean` se reconocen).
- **Pendiente de deploy + verificación manual en Creator** (ver el orden de deploy abajo).

### Orden de deploy (restricción dura)
`materialize_service_report` cambió de **aridad** (2 → 1) y los 3 tools pasan a llamar funciones
nuevas, así que deployar un caller sin su callee rompe producción. Subir **juntos**:
`service_scan_batches`, `service_scan_truncated`, `materialize_service_report`, los 3 fetchers
(`fetch_services_report_by_ids`, `fetch_services_report_by_date_window`,
`fetch_all_services_report_by_ids`) y los 3 tools de ranking.

### Números honestos del resultado
- Costo por registro: **~40 → ~25** (el materializador baja ~9; el cuerpo de agregación de cada tool,
  ~15-20, es el piso y no se tocó).
- Cobertura: **400 servicios** por corrida (antes 200 en el acotado; el "completo" no terminaba).
- El ranking **NO es exacto a escala**: es una muestra de los 400 IDs más bajos de la cohorte, con
  `truncated = true` cuando la cohorte los supera. La exactitud real requiere el precalculo por
  función programada (opción descartada por ahora).
- El tope se puede subir **solo** con el techo de sentencias medido (sonda en `METRICS.md`); un tope
  demasiado alto reintroduce el cuelgue de 45 s.

### Follow-ups identificados (no ejecutados)
- Recortar el cuerpo de agregación de los 3 tools (la cadena de guards cuesta ~9 sentencias por
  registro) o pasar a listas paralelas + `for each index`: ~25 → ~15/registro, y con eso el tope
  sube sin gastar presupuesto.
- Medir el techo real con la sonda y recalcular `service_scan_batches`.
- `prefetch_service_refs` sigue usándose en `fetch_services_by_ids` / `fetch_services_all` /
  `fetch_pkg_tracking_*` (paths NO de ranking) — no se tocó.
- Borrado de `fetch_services_by_ids` y `fetch_services_report_by_date_window` (sin callers).
