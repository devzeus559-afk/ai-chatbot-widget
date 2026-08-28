# Tasks: Widget Export of Visualizations (widget-export-visualizations)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~300–360 (widget.html only: CSS 1.8c ~35, JS 3.8b ~220, CONFIG templates ~50, wiring ~20) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR; 2 work-unit commits |
| Delivery strategy | single-pr |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units (single PR, one commit per unit)

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Phase 1 CSV: CSS 1.8c, builders, submenu, wiring, `runExport` CSV | PR 1 | N/A — no test runner; static read-diff of builders + manual Creator check | `npm start` in `LM2Chatbot` → `/app` local mode; real tool replies require Zoho Creator (Client API) | Revert `LM2Chatbot/app/widget.html` only |
| 2 | Phase 2A XLSX + `EXPORT_TEMPLATES` + `track_package` object export | PR 1 | N/A — no test runner; static read-diff + manual Creator check | Same as Unit 1 | Same single-file revert |

## Phase 1: CSV export (native, zero deps)

- [x] 1.1 Add CSS block 1.8c after `.zc-bar-label` (~517): `.zc-viz-toolbar`, `.zc-export-menu`, menuitem/disabled styles matching palette.
- [x] 1.2 Add JS section 3.8b after `renderVisualization` (~1689): `csvEscape` (RFC 4180), `buildExportMatrix(ctx)` (header `["Categoría", ...series names]`, one row per label, null-coalesced), `buildCsv` (BOM + CRLF).
- [x] 1.3 Add `downloadBlob(blob, filename)` — objectURL + temp `<a download>` + click + revoke (mirror `exportBtn` ~1882).
- [x] 1.4 Add `localIsoDate()` (local, NOT UTC) + `exportFilename(toolName, ext)` → `export-{toolName}-{YYYY-MM-DD}.{ext}`.
- [x] 1.5 Add `TITLE_PREFIXES` (`Clientes más frecuentes`→`report_top_customers`, `Paquete`→`track_package`) + `resolveExportContext(text, viz)` → `{toolName, viz, obj:null, template:null}`; null for type `none`/missing; unmapped → `"viz"` (2.2 replaces this map). Manual: no control on plain replies.
- [x] 1.6 Add `renderExportToolbar(parentEl, ctx)`: button `aria-haspopup="menu"`/`aria-expanded` + `title`, `role="menu"` with one CSV `role="menuitem"`; outside-click + Escape close; items disabled during export; call from `renderVisualization` (table/bar only). Manual: toolbar appears on viz.
- [x] 1.7 Add `runExport(ctx, "csv")`: matrix → `buildCsv` → Blob `text/csv;charset=utf-8` → `downloadBlob` + success toast; try/catch → console.error + failure toast; never throws into chat pipeline.

## Phase 2A: XLSX (SheetJS lazy) + templates

- [x] 2.1 CONFIG (~888): add `CONFIG.EXPORT_TEMPLATES` — `report_top_customers` (titlePrefix `Clientes más frecuentes`, sheetName `Top Clientes`, columns `[{key:"label",header:"Cliente",width:24},{key:"s0",header:"Servicios",width:12}]`, freezePane `{ySplit:1}`, autoFilter true, headerStyle `{bold, bg:"FFF3E6", color:"333333"}`), `track_package` (titlePrefix `Paquete`, 5 key-mapped columns, freezePane null, autoFilter false) — plus `CONFIG.SHEETJS_CDN` pinned cdnjs `xlsx/0.18.5` and built-in `GENERIC_EXPORT_TEMPLATE` (sheetName `Datos`, default widths, freeze, autoFilter).
- [x] 2.2 Replace `TITLE_PREFIXES`: `resolveExportContext` matches `viz.title` startsWith any entry `titlePrefix` → toolName; unknown → `"viz"` + generic template.
- [x] 2.3 Add `parseTrackingText(text)` — guard `/^Paquete .+\nEstado: /`; line prefixes `Paquete `, `Estado: `, `Fecha actualización: `, `Origen: `, `Destino: ` (missing optional lines → "") → `{trackingNumber,status,lastUpdate,origin,destination}`; wire into `resolveExportContext` + toolbar in `renderMessageNode` (null-viz path).
- [x] 2.4 Add `loadSheetJS()` — lazy, promise-guarded, once; null `xlsxPromise` on error/timeout (10s) for retry.
- [x] 2.5 Add `buildWorkbook(matrix, template)` — `aoa_to_sheet`, `!cols` widths, `!autofilter`, `!freeze` (`{xSplit:0, topLeftCell:"A2"}` + `ySplit`), row-0 headerStyle bold+fill, sheetName `.slice(0,31)`.
- [x] 2.6 Extend `runExport(ctx, "xlsx")`: `loadSheetJS` → `buildWorkbook` → `XLSX.write({type:"array",bookType:"xlsx"})` → xlsx Blob → `downloadBlob`; catch → toast + automatic CSV download of same matrix. Manual: XLSX with headers/freeze/autoFilter.
- [x] 2.7 Add XLSX `role="menuitem"` to submenu wired to `runExport(ctx,"xlsx")`, keeping disabled-during-export. Manual: `track_package` single-row CSV/XLSX with 5 columns.

## Phase 3: Verification (static + manual Creator)

- [x] 3.1 Static read-diff: CSV escaping/BOM/CRLF, multi-series header, `localIsoDate` non-UTC, filename `export-report_top_customers-2026-08-28.csv`, template lookup known/unknown→generic, `parseTrackingText` on fixed sample, submenu aria/listeners, `runExport` isolation.
- [ ] 3.2 Manual (Creator): `report_top_customers` table + ≤8-category bar → CSV opens with accents in Excel; XLSX layout applied; correct filenames.
- [ ] 3.3 Manual (Creator): `track_package` → toolbar under text message (no viz) → single-row CSV/XLSX.
- [ ] 3.4 Manual (Creator): DevTools offline → XLSX toast + auto CSV fallback; conversation continues; `exportBtn` JSON export still works.
- [ ] 3.5 Manual (Creator): re-open saved conversation → export intact (re-parsed envelope, same data); type `none`/missing → no control.

## Phase 4: Rollback / docs

- [x] 4.1 Document: rollback = `git checkout -- LM2Chatbot/app/widget.html` — widget-only, no backend/migration/Creator re-publish; SheetJS injected only on XLSX request (browser cache only).