# Delta Spec: widget-export

Change: **widget-export-visualizations** — adds an Export control (`CSV`/`XLSX`) to rendered visualizations. New domain; all requirements are ADDED. The full normative spec lives at `openspec/specs/widget-export/spec.md`; this delta reflects that capability for this change.

## ADDED Requirements

### Requirement: Export Control Visibility and Semantics

An Export control MUST render for every visualization whose `type` is `table` or `bar`, and MUST NOT render for type `none` or missing type.

- MUST expose a button with a `[CSV / XLSX]` submenu
- MUST NOT alter the existing conversation JSON export button
- SHOULD carry a tooltip/title and be keyboard accessible

#### Scenario: Control on table/bar

- GIVEN a visualization of type `table` or `bar`
- WHEN the viz renders
- THEN an Export control with CSV/XLSX options is present

#### Scenario: No control when none

- GIVEN a visualization of type `none` or with no type
- WHEN the viz renders
- THEN no Export control is shown

### Requirement: CSV Export (Phase 1)

CSV export MUST be generated client-side with vanilla JS and MUST follow RFC 4180 field escaping.

- MUST prefix output with a UTF-8 BOM so Excel opens accents correctly
- MUST emit one row per category from `{labels, series}` when present
- MUST support multiple series (category column plus one column per series)
- MUST download with filename `export-{toolName}-{YYYY-MM-DD}.csv` (ISO date)

#### Scenario: Multi-series CSV

- GIVEN a `bar` visualization with 2 series
- WHEN CSV is exported
- THEN the file has a category column plus one column per series with a BOM and RFC 4180 escaping

#### Scenario: ISO-dated filename

- GIVEN an export on 2026-08-28 for tool `report_top_customers`
- WHEN CSV is downloaded
- THEN the filename is `export-report_top_customers-2026-08-28.csv`

### Requirement: XLSX Export (Phase 2A)

XLSX export MUST generate a real `.xlsx` via SheetJS (`xlsx`) lazy-loaded from CDN on the first XLSX request only.

- MUST derive per-tool layout from `CONFIG.EXPORT_TEMPLATES[tool]` (sheet name, column widths, numeric formats, header style, freeze pane, auto filter)
- MUST apply a generic fallback template when the tool has no entry
- MUST download with filename `export-{toolName}-{YYYY-MM-DD}.xlsx`

#### Scenario: SheetJS injected lazily

- GIVEN a first XLSX export when `window.XLSX` is absent
- WHEN the export is requested
- THEN the CDN script is injected and generation completes
- AND the widget is not affected while loading

#### Scenario: Template applied

- GIVEN `CONFIG.EXPORT_TEMPLATES[tool]` defines a sheet
- WHEN XLSX is generated
- THEN the sheet uses that template's name, widths, formats, header style, freeze pane, and auto filter

### Requirement: Graceful Failure

XLSX export MUST never break the running conversation. If SheetJS fails to load or generate, the export MUST fall back to CSV automatically.

- MUST show a toast on success, on CSV fallback, and on failure
- MUST leave chat state and the conversation JSON export unaffected

#### Scenario: CDN unavailable

- GIVEN the SheetJS CDN fails to load or generation throws
- WHEN a user requests XLSX
- THEN CSV is produced instead and a toast informs the user
- AND the conversation continues without error

### Requirement: Template Configuration Authority

All export templates MUST be defined in `CONFIG.EXPORT_TEMPLATES` inside `widget.html`.

- MUST NOT hard-code per-tool sheet definitions elsewhere
- MUST NOT depend on backend or Deluge data for template layout

#### Scenario: Templates centralized

- GIVEN an export for any tool
- WHEN layout is resolved
- THEN it is read from `CONFIG.EXPORT_TEMPLATES[tool]` or the generic fallback
- AND no layout data comes from the backend

### Requirement: track_package Single-Object Export (Phase 2A)

`track_package` returns a single data object with no visualization, rendered as a deterministic formatted reply. Because the widget envelope carries no raw data object, the widget MUST reconstruct the object by parsing that formatted reply text, then export it as a single-row sheet.

- MUST reconstruct the object client-side from the deterministic `format_tracking` reply (fixed prefixes: tracking number, status, last update, origin, destination)
- MUST map the reconstructed keys to columns (single record → single-row output) using `CONFIG.EXPORT_TEMPLATES.track_package`
- MUST use the same CSV/XLSX submenu and filename convention

#### Scenario: Single-row sheet

- GIVEN a `track_package` reply whose text matches the `format_tracking` template
- WHEN XLSX or CSV export is requested
- THEN the reply text is parsed into an object and written as a single row using the `track_package` column mapping

### Requirement: Determinism and No Backend Coupling

Export MUST be deterministic given the same input and MUST use `{labels, series}` as the source of truth where available.

- MUST use ISO `YYYY-MM-DD` dates for filenames
- MUST NOT call the Zoho Creator API or the Deluge backend to produce an export

#### Scenario: Source of truth is the shape

- GIVEN a visualization already rendered
- WHEN CSV/XLSX is generated
- THEN data is read from `{labels, series}` (or the data object for `track_package`)
- AND no backend call occurs
