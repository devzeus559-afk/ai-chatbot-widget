# Design: widget-export-visualizations — Export Button for Rendered Visualizations

## Objective / Scope Recap

Add an **Export** control (submenu `[CSV / XLSX]`) to every rendered `table`/`bar` visualization, plus a direct single-object export for `track_package`. Phase 1 = native client-side CSV (zero deps); Phase 2A = real `.xlsx` via SheetJS lazy-loaded from CDN, layout driven by per-tool templates in `CONFIG.EXPORT_TEMPLATES`. **Widget-only diff** — no Deluge/server changes; conversation-JSON export (`exportBtn`) stays intact. Phase 2B (Zoho Sheets/WorkDrive) excluded.

## Architecture / Approach

A self-contained **export module** inside `widget.html` (new JS section **3.8b** after `renderVisualization`, ~line 1689; new CSS block **1.8c** after `.zc-bar-label`, ~line 517; `CONFIG.EXPORT_TEMPLATES` added at ~line 888). It is pure browser-side: no new Client API calls, no backend, no build step.

Two entry points feed one shared pipeline:

1. `renderVisualization` (line 1669) — when `viz.type` is `table`/`bar`, append an export toolbar inside the `.zc-viz-container` wrapper.
2. `renderMessageNode` (line 1691) — when `viz` is null and the text matches the deterministic `format_tracking` template, append the same toolbar under the message node (`track_package` path).

The toolbar holds an export **context** object (closure, not DOM serialization): `{toolName, viz|null, obj|null, template}` — context is resolved from the *parsed envelope*, so the export reads **the same data the user sees**, including historically re-loaded messages (same `renderMessageNode` path).

A single **matrix builder** (`buildExportMatrix`) produces rows from either the `{labels, series}` shape (CSV and XLSX share it — one source of truth) or from the parsed tracking object. CSV and XLSX are byte-for-byte consistent outputs of that matrix.

## Architecture Decisions

| Decision | Option | Tradeoff | Decision |
|---|---|---|---|
| Tool-name resolution (filename `export-{toolName}-{date}` — envelope carries no tool name) | Backend adds `"tool"` to envelope | Violates widget-only diff | Rejected |
| | `titlePrefix` per entry in `EXPORT_TEMPLATES` (exact match vs `viz.title`) | Deterministic, static, testable; drift risk if backend title changes | **Chosen** — `viz.title` startsWith any entry `titlePrefix` → that tool; else `generic` |
| `track_package` data source (envelope has `visualization: null`, only formatted text) | Backend ships `"data"` in envelope | Violates widget-only diff | Rejected |
| | Deterministic parse of `format_tracking` output (fixed prefixes: `Paquete `, `Estado: `, `Origen: `, `Destino: `…) | Widget-only, deterministic; coupled to a static template in the same repo | **Chosen** — `parseTrackingText(text)` → object; keys `trackingNumber, status, lastUpdate, origin, destination` |
| CSV vs XLSX delivery | One format only | Spec mandates both via submenu | Rejected |
| | CSV native (Phase 1) + XLSX lazy SheetJS (Phase 2A) | CSV universal + numeric fidelity of real xlsx | **Chosen** — proposal-mandated |
| SheetJS source | unpkg/latest | Version churn, non-reproducible | Rejected |
| | **Pinned** `https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js` | Deterministic, widely cached; injected only on first XLSX request | **Chosen** — `CONFIG.SHEETJS_CDN` |
| Which templates ship | Entries for all 6 tools | 4 lookup tools emit **no viz today** (verified: only `report_top_customers` returns `visualization`) → dead config | Rejected |
| | Entries for `report_top_customers` + `track_package` only; built-in `GENERIC_EXPORT_TEMPLATE` fallback | No dead config; spec's "generic fallback when no entry" satisfied | **Chosen** |
| Layout authority vs shape | Template columns define headers | Spec: `{labels, series}` is the source of truth | Rejected |
| | Headers/values **always from the shape**; template `columns` supply only positional `width/format/style` (viz tools) — for `track_package`, `columns[].key` maps object keys | Spec-compliant ("source of truth is the shape") | **Chosen** |
| Failure behavior | XLSX errors propagate into render pipeline | Breaks conversation (spec forbids) | Rejected |
| | try/catch everywhere; async handlers never throw into chat; XLSX fail → toast + automatic CSV fallback | Graceful, spec-mandated | **Chosen** |
| Filename date | `new Date().toISOString()` (UTC) | Off-by-one day near midnight vs user's local day | Rejected |
| | Local date components `YYYY-MM-DD` | Matches user's local day; deterministic per day/tool | **Chosen** |

## Data Flow

```
Reply envelope {"text","visualization"} ──renderMessageNode──▶ parsed {text, viz}
  ├─ viz.type ∈ {table,bar} ──▶ renderVisualization(viz) ──▶ wrapper ──▶ renderExportToolbar(ctx)
  └─ viz null ∧ /^Paquete .+\nEstado: / ──▶ parseTrackingText(text) ──▶ renderExportToolbar(ctx)   [track_package]

ctx = {toolName, viz|null, obj|null, template}   (closure; same data the user sees)

User: Export ▾ → menu
  CSV  ──▶ buildExportMatrix(ctx) ──▶ csvEscape + BOM ──▶ Blob "text/csv;charset=utf-8" ──▶ download export-{tool}-{localDate}.csv
  XLSX ──▶ loadSheetJS() ──▶ buildWorkbook(matrix, template) ──▶ XLSX.write{type:"array"} ──▶ Blob xlsx ──▶ download .xlsx
              └─ fail (CDN/load/generate) ──▶ toast + CSV fallback (never reaches chat pipeline)
```

## CONFIG.EXPORT_TEMPLATES Schema

```js
EXPORT_TEMPLATES: {
  report_top_customers: {
    titlePrefix: "Clientes más frecuentes",   // tool-name resolution (exact prefix match on viz.title)
    filename: "export-{toolName}-{date}",     // tokens: {toolName}, {date}=local YYYY-MM-DD; default if omitted
    sheetName: "Top Clientes",
    columns: [                                // POSITIONAL for viz tools: width/format/style only (headers come from the shape)
      { key: "label", header: "Cliente",  width: 24, format: "@",  style: {} },
      { key: "s0",    header: "Servicios", width: 12, format: "0", style: {} },
    ],
    freezePane: { ySplit: 1 },                // freeze header row (ws['!freeze'])
    autoFilter: true,                         // ws['!autofilter'] = {ref: ws['!ref']}
    headerStyle: { bold: true, bg: "FFF3E6", color: "333333" },  // SheetJS CE write subset: bold + fill
  },
  track_package: {                            // OBJECT path: columns[].key maps parsed-object keys → single-row sheet
    titlePrefix: "Paquete",
    filename: "export-{toolName}-{date}",
    sheetName: "Paquete",
    columns: [
      { key: "trackingNumber", header: "Tracking No.",      width: 20 },
      { key: "status",         header: "Estado",            width: 14 },
      { key: "lastUpdate",     header: "Última actualización", width: 24 },
      { key: "origin",         header: "Origen",            width: 26 },
      { key: "destination",    header: "Destino",           width: 26 },
    ],
    freezePane: null, autoFilter: false,
    headerStyle: { bold: true, bg: "FFF3E6", color: "333333" },
  },
},
SHEETJS_CDN: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
```

Lookup: `resolveTemplate(toolName)` → `EXPORT_TEMPLATES[toolName]`; tools without an entry (or unknown tool) → built-in `GENERIC_EXPORT_TEMPLATE` (`sheetName "Datos"`, default widths, freeze header, autoFilter on).

## Detailed Design

**CSV builder** — RFC 4180 + UTF-8 BOM:

```js
function csvEscape(v) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
// multi-series headers: ["Categoría", ...viz.series.map(s => s.name)]
// rows: labels.map((label, i) => [label, ...series.map(s => s.values[i] ?? "")])
// output: "\uFEFF" + rows.map(r => r.map(csvEscape).join(",")).join("\r\n")
```

Download via `Blob([csv], {type:"text/csv;charset=utf-8;"})` → `URL.createObjectURL` → temp `<a download>` click → `revokeObjectURL` (mirrors `exportBtn` pattern, line 1882).

**XLSX builder** — SheetJS only on demand:

```js
let xlsxPromise = null;
function loadSheetJS() {                       // lazy, once, promise-guarded
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxPromise) return xlsxPromise;
  xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = CONFIG.SHEETJS_CDN;
    s.onload  = () => window.XLSX ? resolve(window.XLSX) : (xlsxPromise = null, reject(new Error("XLSX missing")));
    s.onerror = () => { xlsxPromise = null; reject(new Error("SheetJS CDN failed")); };
    document.head.appendChild(s);
    setTimeout(() => { xlsxPromise = null; reject(new Error("SheetJS load timeout")); }, 10000);
  });
  return xlsxPromise;
}
function buildWorkbook(matrix, tpl) {           // matrix = header row + body rows (same as CSV)
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  ws["!cols"] = tpl.columns.map(c => ({ wch: c.width }));        // widths
  if (tpl.autoFilter) ws["!autofilter"] = { ref: ws["!ref"] };   // auto filter
  if (tpl.freezePane) ws["!freeze"] = Object.assign({ xSplit: 0, topLeftCell: "A2" }, tpl.freezePane);
  if (tpl.headerStyle) XLSX.utils.encode_range(...) → set row 0 cells' s = { font:{bold}, fill:{fgColor:{rgb}} };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (tpl.sheetName || "Datos").slice(0, 31));
  return wb;                                   // XLSX.write(wb, {type:"array", bookType:"xlsx"}) → Blob
}
```

**Submenu UI** — button + dropdown, one instance per viz:

```
zc-viz-toolbar: [ Export ▾ ]  zc-export-menu: [ CSV ] [ XLSX ]
```

- Button `aria-haspopup="menu"`, `aria-expanded` toggled; menu `role="menu"` with two `role="menuitem"` buttons.
- Toggle on click; close on outside `document` click (one listener) and on `Escape`; buttons disabled while an export runs.
- Toast feedback via existing `showToast` (line 1386): success / CSV-fallback / failure.

**Filename helper** — local date, not UTC:

```js
function localIsoDate() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
// exportFilename(toolName, ext) → `export-${toolName}-${localIsoDate()}.${ext}`
```

**Failure handling** — `runExport(ctx, format)` wraps everything in try/catch; `buildExportMatrix` cannot throw on the shape (null-coalesced values); XLSX path catches load/generate errors → `console.error` + toast + **automatic CSV download of the same matrix**; the chat/render pipeline is never touched. Conversation-JSON export (`exportBtn`) is a separate handler, untouched.

## Interfaces / Contracts

```js
resolveExportContext(text, viz) → ctx|null      // {toolName, viz|null, obj|null, template}; null ⇒ no export control
renderExportToolbar(parentEl, ctx)              // appends toolbar + wires submenu/click-outside
buildExportMatrix(ctx, template) → string[][]   // header row + body rows (CSV & XLSX share it)
csvEscape(v) → string                           // RFC 4180
buildCsv(matrix) → string                       // BOM + CRLF rows
buildWorkbook(matrix, template) → Workbook      // SheetJS; widths/freeze/autoFilter/headerStyle
parseTrackingText(text) → obj                   // track_package single-object
exportFilename(toolName, ext) → string          // export-{toolName}-{local YYYY-MM-DD}.{ext}
downloadBlob(blob, filename)                    // objectURL + <a> + revoke
runExport(ctx, format)                          // async; never throws into chat pipeline
```

## Zoho Creator Constraints (widget context)

| Constraint | Impact |
|---|---|
| No backend calls from widget (Client API only for chat state) | Export is 100% in-browser; **zero new Creator API calls**; `clientApi`/polling flow untouched |
| Viz data already in memory (≤200 rows from Creator getRecords cap) | Downloads are bounded; no pagination needed |
| Single-file widget, no build step | All export code lives inside `widget.html`; SheetJS injected at runtime only on explicit XLSX request |
| Backend envelope is fixed `{text, visualization}` (no Deluge changes allowed) | Tool name + track_package object resolved client-side (`titlePrefix` + deterministic text parse) |

## File Changes

| File | Action | Description |
|---|---|---|
| `LM2Chatbot/app/widget.html` | Modify | `CONFIG` (~line 888): `EXPORT_TEMPLATES` + `SHEETJS_CDN`. CSS 1.8c after `.zc-bar-label` (~517): toolbar/submenu styles. JS 3.8b after `renderVisualization` (~1689): export module (ctx resolution, CSV, SheetJS loader, workbook, submenu, filename, runExport). `renderVisualization` + `renderMessageNode` call `renderExportToolbar`. |

No other files touched.

## Testing Strategy

No local runner (AGENTS.md) — static review + manual Creator checks:

| Layer | What to Test | Approach |
|---|---|---|
| Static | RFC 4180 escaping (quote/double-quote, comma, newline), BOM prefix, multi-series header row `["Categoría", ...names]`, CRLF rows | Read-diff the builders |
| Static | Filename with fixed date → `export-report_top_customers-2026-08-28.csv`; token expansion; local (non-UTC) date | Read-diff `localIsoDate`/`exportFilename` |
| Static | Template lookup: known tool / unknown tool → generic fallback; `titlePrefix` matching | Read-diff resolver |
| Static | `parseTrackingText` on a fixed `format_tracking` sample → 5-key object; single-row matrix | Read-diff parser |
| Static | Submenu: aria attributes, outside-click + Escape close, `aria-expanded` toggle | Read-diff listeners |
| Manual (Creator) | `report_top_customers` reply (table and ≤8-category bar) → CSV downloads and opens with accents in Excel; XLSX downloads with headers/freeze/autoFilter | Live widget run |
| Manual (Creator) | `track_package` reply → export control under message → single-row CSV/XLSX with the 5 columns | Live widget run |
| Manual (Creator) | DevTools offline → XLSX toast + automatic CSV fallback; conversation continues; JSON `exportBtn` still works | Live widget run |
| Manual (Creator) | Re-open a saved conversation → export still present (envelope re-parsed, same data) | Live widget run |

## Threat Matrix

`N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.` (CDN `<script>` injection and Blob downloads are DOM-level, not process integration.)

## Migration / Rollout

No migration, no feature flag, no Creator re-publish. Rollback: `git checkout -- LM2Chatbot/app/widget.html` (revert the single file) — no backend/state/data migration. SheetJS is never cached by widget code (only browser HTTP cache) and is not injected unless an XLSX export is requested.

## Open Questions

- [ ] **titlePrefix drift**: backend `viz.title` changes would silently unmap a tool → generic template + `export-viz-*` stem. Titles are static strings in `chat_common.deluge`/`tool_report_top_customers.deluge` (same repo); verify mappings in verify phase.
- [ ] **Other 4 lookup tools emit no `visualization` today** (verified in source) — export control appears only for `report_top_customers` and `track_package` until a backend change (out of scope) ships viz for them. Confirm this matches intent of the "5 tools" proposal claim.
- [ ] `ws['!freeze']` / `ws['!autofilter']` acceptance in target Excel/WPS — manual check in verify; cosmetic if unsupported.

## Risks

| Risk | Mitigation |
|---|---|
| SheetJS CDN offline/blocked | CSV fallback + toast; script injected only on request; pinned cdnjs version |
| Template drift from backend fields | Centralized in `CONFIG`; generic fallback; static smoke of the 2 live exporters |
| `titlePrefix`/tracking-parse coupling to backend text | Same-repo static strings; verify-phase check; generic fallback as safety net |
| Same-day filename collisions | Deterministic per tool/day; acceptable for manual export (proposal) |