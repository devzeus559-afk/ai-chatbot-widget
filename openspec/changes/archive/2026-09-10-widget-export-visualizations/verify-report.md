```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:17df15d295d295ac917db2cf3dcce6a0a46537a438ee582a86010e4176e275eb
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 7/7
scenarios: 10/10
test_command: ""
test_exit_code: 0
test_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
build_command: ""
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: widget-export-visualizations
**Version**: N/A (delta spec `widget-export`; all requirements ADDED)
**Mode**: Standard (strict_tdd=false, no test runner — `openspec/config.yaml`)

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 20 |
| Tasks complete | 20 |
| Tasks incomplete | 0 |

All 20 tasks `[x]` in `openspec/changes/widget-export-visualizations/tasks.md` (Phase 1: 1.1–1.7, Phase 2A: 2.1–2.7, Phase 3: 3.1–3.5, Phase 4: 4.1). Gates 3.2–3.5 carry user live-Creator verification recorded 2026-09-10.

### Build & Tests Execution

**Build**: ➖ Not applicable — `build_command: ""` per `openspec/config.yaml` (`verify.build_command`), `chatbot-widget` is a static single-file widget with no build step.

**Tests**: ➖ Not applicable — no test runner exists in this project (`test_command: ""`, `strict_tdd: false`). Per `AGENTS.md`, verification is static review of source + manual checks in Zoho Creator. No test commands were invented or run; both exit codes recorded as 0 with the SHA-256 digest of exact empty output (`sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`).

**Coverage**: ➖ Not available (coverage_threshold 0, no runner).

### Spec Compliance Matrix

Spec: `openspec/changes/widget-export-visualizations/specs/widget-export/spec.md` — 7 requirements, 10 scenarios (counted directly from the file: 7 `### Requirement:` blocks, 10 `#### Scenario:` blocks). Evidence file: `chatbot-widget/app/widget.html` (design/docs reference the pre-rename path `LM2Chatbot/app/widget.html`; commit `a65e59b` renamed the directory — verified via `git log --diff-filter=R`). All line numbers below verified by direct read.

| Requirement | Scenario | Test / Evidence | Result |
|-------------|----------|-----------------|--------|
| REQ-01 Export Control Visibility and Semantics | S1 Control on table/bar | Static: `renderVisualization` (1810–1832) renders `renderExportToolbar(wrapper, resolveExportContext(null, viz))` (1830) inside `.zc-viz-container` for `table`/`bar`; `renderExportToolbar` (2052–2124) builds button + `[CSV][XLSX]` submenu (2118–2119). Manual: Creator gates 3.2, 3.5 (user-verified live 2026-09-10). | ✅ COMPLIANT |
| REQ-01 Export Control Visibility and Semantics | S2 No control when none | Static: `renderVisualization` early-returns on `!viz || viz.type === "none" || !viz.type` (1811); `resolveExportContext` returns `null` for none/missing non-tracking text (1930–1941); `renderExportToolbar` returns when `!ctx` (2053). Manual: gate 3.5 (user-verified live). | ✅ COMPLIANT |
| REQ-02 CSV Export (Phase 1) | S3 Multi-series CSV | Static: `buildExportMatrix` (1852–1867) emits header `["Categoría", ...series names]` (1861) and one row per label with null-coalesced `s.values[i]` (1862–1865); `buildCsv` (1870–1875) prefixes UTF-8 BOM `\uFEFF` and joins rows with CRLF; `csvEscape` (1844–1847) implements RFC 4180 quote/double-quote/comma/newline escaping. Manual: gate 3.2 (`report_top_customers` table + bar CSV opens with accents in Excel). | ✅ COMPLIANT |
| REQ-02 CSV Export (Phase 1) | S4 ISO-dated filename | Static: `exportFilename` (1897–1903) → `export-{toolName}-{YYYY-MM-DD}.{ext}` via `localIsoDate` (1890–1894, local `getFullYear/getMonth/getDate`, never UTC); `export-report_top_customers-2026-08-28.csv` pattern reproduced. Manual: gate 3.2 (correct filenames, user-verified). | ✅ COMPLIANT |
| REQ-03 XLSX Export (Phase 2A) | S5 SheetJS injected lazily | Static: `loadSheetJS` (1960–1985) creates the `<script src=CONFIG.SHEETJS_CDN>` element only inside the promise and only on first XLSX request (called solely from the xlsx branch of `runExport`, 2025); promise-guarded (`xlsxPromise`), retry reset on error/timeout 10s (1970–1982); async — widget render unaffected while loading. Manual: gate 3.4 (DevTools offline behavior, user-verified). | ✅ COMPLIANT |
| REQ-03 XLSX Export (Phase 2A) | S6 Template applied | Static: `buildWorkbook` (1989–2016) applies `!cols` widths from `tpl.columns` (1991–1993), `!autofilter` (1994), `!freeze` (`{xSplit:0, topLeftCell:"A2"}` + `ySplit`, 1995–1997), row-0 header style bold+fill+color (1998–2011), sheetName `.slice(0,31)` (2014). Templates at `CONFIG.EXPORT_TEMPLATES` (931–959). Manual: gate 3.2 (XLSX layout applied, user-verified). | ✅ COMPLIANT |
| REQ-04 Graceful Failure | S7 CDN unavailable | Static: `runExport` xlsx branch catch (2033–2038) logs, toasts "XLSX unavailable — exported CSV instead", and downloads CSV of the SAME matrix; outer catch (2044–2047) toasts "Export failed"; async handler never throws into the chat pipeline. Manual: gate 3.4 — DevTools offline → XLSX toast + automatic CSV fallback; conversation continues; `exportBtn` JSON export still works (user-verified live). | ✅ COMPLIANT |
| REQ-05 Template Configuration Authority | S8 Templates centralized | Static: per-tool templates in `CONFIG.EXPORT_TEMPLATES` (931–959); built-in `GENERIC_EXPORT_TEMPLATE` module-level fallback (994–1000); `resolveTemplate` (1906–1908) = `CONFIG.EXPORT_TEMPLATES[toolName] || GENERIC_EXPORT_TEMPLATE`; layout resolution reads only these constants — zero backend/Deluge data in the export path (no Client API calls in the module). | ✅ COMPLIANT |
| REQ-06 track_package Single-Object Export (Phase 2A) | S9 Single-row sheet | Static: `parseTrackingText` (1912–1925) reconstructs `{trackingNumber,status,lastUpdate,origin,destination}` from fixed prefixes `Paquete `, `Estado: `, `Fecha actualización: `, `Origen: `, `Destino: `; guard `/^Paquete .+\nEstado: /` (1932); `buildExportMatrix` object path (1853–1859) emits header + single row via `CONFIG.EXPORT_TEMPLATES.track_package` column mapping (948–954); wired under the message node in `renderMessageNode` (2158–2160); same CSV/XLSX submenu (2118–2119). Manual: gate 3.3 — toolbar under text message, single-row CSV/XLSX with 5 columns (user-verified live). | ✅ COMPLIANT |
| REQ-07 Determinism and No Backend Coupling | S10 Source of truth is the shape | Static: `buildExportMatrix` reads headers/values from `viz.labels`/`viz.series` (1861–1864) — the identical shape rendered by `renderTable` (1741–1773) and `renderBarChart` (1775–1807) — or from the parsed object for `track_package`; filenames use local `YYYY-MM-DD` (1890–1903); no Client-API/backend call exists in any export code path. Deterministic: same input → same matrix → same bytes (one shared matrix feeds both CSV and XLSX, 1849–1851 comment; runExport 2020–2048). | ✅ COMPLIANT |

**Compliance summary**: 10/10 scenarios compliant (static read-diff of every builder/handler with real line references + user live-Creator evidence for gates 3.2–3.5).

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| REQ-01 Export Control Visibility and Semantics | ✅ Implemented | Toolbar only for `table`/`bar` (1830); none for `none`/missing (1811, 1930–1941, 2053); `aria-haspopup="menu"`, `aria-expanded` toggled, `title` tooltip, keyboard focus styles (2058–2064, CSS 519–583); JSON `exportBtn` handler intact (2366–2385). |
| REQ-02 CSV Export (Phase 1) | ✅ Implemented | Vanilla JS, zero deps; RFC 4180 `csvEscape` (1844–1847); BOM + CRLF `buildCsv` (1870–1875); multi-series matrix (1852–1867); Blob `text/csv;charset=utf-8` (2042); ISO local-date filename (1890–1903). |
| REQ-03 XLSX Export (Phase 2A) | ✅ Implemented | Lazy pinned SheetJS 0.18.5 cdnjs (961, 1960–1985); real `.xlsx` via `XLSX.write({type:"array",bookType:"xlsx"})` (2027); per-tool template layout (1989–2016); generic fallback (994–1000, 1906–1908). |
| REQ-04 Graceful Failure | ✅ Implemented | try/catch isolation (2020–2047); XLSX fail → toast + automatic CSV of same matrix (2033–2038); success toasts (2032, 2043); `showToast` (1541); chat pipeline untouched; JSON export separate (2366–2385, 2387–2418). |
| REQ-05 Template Configuration Authority | ✅ Implemented | All per-tool templates in `CONFIG.EXPORT_TEMPLATES` (931–959); generic fallback module-level (994–1000); no backend layout data (module contains no `clientApi`/`getAllRecords` calls). |
| REQ-06 track_package Single-Object Export (Phase 2A) | ✅ Implemented | Deterministic text reconstruction (1912–1925); single-row matrix with 5 mapped columns (1853–1859); toolbar under text message (2158–2160); same submenu and filenames. |
| REQ-07 Determinism and No Backend Coupling | ✅ Implemented | `{labels, series}` is the single source of truth for viz exports (1861–1864) — shared by CSV and XLSX; local ISO dates (1890–1903); creator dates parsed as local, not UTC (`toTimestamp` 1118–1133, commit c28a8a8); export path makes zero backend calls. |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Tool-name resolution via `titlePrefix` exact match on `viz.title` (unknown → generic) | ✅ Yes | `EXPORT_TEMPLATES` titlePrefix entries (932, 945); `resolveExportContext` startsWith loop (1946–1952); fallback `"viz"` + generic (1953). |
| `track_package` object from deterministic parse of `format_tracking` text | ✅ Yes | `parseTrackingText` (1912–1925) with the 5 fixed prefixes; guard regex (1932); optional missing lines → `""` (1914–1917). |
| CSV native (Phase 1) + XLSX lazy SheetJS (Phase 2A), both from one shared matrix | ✅ Yes | `buildExportMatrix` → `buildCsv` / `buildWorkbook`; `runExport` chooses by format (2020–2048). |
| Pinned `SHEETJS_CDN` (cdnjs xlsx 0.18.5), injected only on first XLSX request | ✅ Yes | `CONFIG.SHEETJS_CDN` (961); `loadSheetJS` lazy + promise-guarded + retry reset (1960–1985). |
| Templates only for `report_top_customers` + `track_package`; built-in generic fallback | ✅ Yes | `EXPORT_TEMPLATES` (931–959); `GENERIC_EXPORT_TEMPLATE` (994–1000); `resolveTemplate` (1906–1908). |
| Headers/values always from the shape; template `columns` only positional width/format/style; `columns[].key` maps object keys for track_package | ✅ Yes | Matrix always from `{labels, series}` (1861–1864) or obj keys (1856–1857); columns used only for `!cols` widths (1991–1993); design's `format`/`style` per-column fields not applied at runtime (cosmetic omission, layout still per template). |
| Failure never breaks conversation; XLSX fail → toast + automatic CSV fallback | ✅ Yes | Nested try/catch (2020–2047); fallback downloads same matrix CSV (2036–2037); toasts on success/fallback/failure (2032, 2035, 2043, 2046). |
| Filename uses LOCAL date `YYYY-MM-DD` (not UTC) | ✅ Yes | `localIsoDate` (1890–1894); `exportFilename` (1897–1903); Creator timestamp parse without `Z` (1123–1130, commit c28a8a8 — user-intended). |
| Submenu UI: `aria-haspopup`/`aria-expanded`, `role="menu"` + `role="menuitem"`, outside-click + Escape close, disabled while exporting | ✅ Yes | `renderExportToolbar` (2052–2124); document click/keydown listeners (2079–2096); `setBusy` disables button + items (2071–2077). |
| Export reads the same data the user sees, including re-loaded conversations | ✅ Yes | Envelope re-parsed on reload in `renderMessageNode` (2126–2150); `selectConversation` re-renders via `renderMessageNode` (1634); context built from parsed envelope, not DOM (1929–1955). |
| Download via objectURL + `<a download>` + revoke (mirrors `exportBtn`) | ✅ Yes | `downloadBlob` (1878–1887); JSON export handler separate and intact (2366–2385). |

### Issues Found

**CRITICAL**: None

**WARNING**:
- **W1 — JSON Export/Import buttons hidden unconditionally.** Commit `c28a8a8` ("hide Export/Import buttons") added the `hidden` class to `.sidebar-footer` hardcoded in the HTML (line 802; `.hidden` = `display:none !important`, 767–769). No JS ever toggles it (grep confirms zero `sidebar-footer` references in script). The orchestrator's final-state facts record this as intended and user-verified live ("Exportar/Importar buttons hidden correctly" with no chat history). Two nuances verified here: (a) the hiding is unconditional, whereas that fact describes the no-history state — if conditional visibility (show only when history exists) was the intent, it is not implemented; (b) REQ-01's "MUST NOT alter the existing conversation JSON export button": the handler (2366–2385), toast, and JSON download are byte-intact, only UI visibility changed by user decision. Not a blocker; user's live verification stands.

**SUGGESTION**:
- **S1 — Future `line` viz type would render an export toolbar over an empty chart.** `renderVisualization` (1810–1832) guards only `none`/missing (1811) and calls the toolbar (1830) for any other type; the `switch` (1820–1828) renders only `table`/`bar`. Today the backend emits only `table`/`bar`, and the spec forbids only `none`/missing, so compliant — tighten the guard to `table`/`bar` when "line" ships.
- **S2 — Docs path drift** (no code impact): `design.md`, `tasks.md`, root `AGENTS.md` reference `LM2Chatbot/app/widget.html`; commit `a65e59b` renamed the directory, so the implementation lives at `chatbot-widget/app/widget.html`.
- **S3 — Out-of-scope working-tree modification**: `creatorapp-backup/Logistic_Management_II.ds` has uncommitted changes (+5826/−396) from live Creator testing. Not part of this change's widget-only diff; flagged for awareness before archiving.

### Verdict

**PASS WITH WARNINGS**
All 20/20 tasks complete; 7/7 requirements and 10/10 scenarios compliant (static read-diff with verified line references + user live-Creator evidence for gates 3.2–3.5, 2026-09-10). One non-blocking warning (W1: unconditional hiding of JSON Export/Import buttons — user-intended per commit `c28a8a8` and live verification) and three suggestions. No blockers, no critical findings; not archive-blocked.