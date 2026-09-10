# Proposal: widget-export-visualizations — Export Button for Rendered Visualizations

## Intent
The widget renders AI replies carrying `{text, visualization:{type, labels, series}}` (`table`/`bar`) **when the backend emits a visualization** — today only `report_top_customers` does (the 4 lookup tools `search_services`/`find_offices`/`check_coverage`/`find_contacts` return text without one, pending a future backend change out of scope). `track_package` returns a single object rendered as formatted text. Users can only back up conversations as JSON (`exportBtn`), not download displayed data. Add an **Export** button to each visualization for CSV / `.xlsx`, plus a single-object export for `track_package`.

**Widget-only fact (verified in source):** the reply envelope is strictly `{"text","visualization"}` — it carries **no tool name** and **no raw data object**. Tool-name resolution and the `track_package` object are derived client-side (see Approach), because no Deluge change is allowed in this change.

## Scope

### In Scope
- **Phase 1**: native client-side CSV export (vanilla JS, zero deps) for `table`/`bar` visualizations.
- **Phase 2A**: real `.xlsx` via SheetJS (`xlsx`) lazy CDN, per-tool **JSON templates** in `CONFIG.EXPORT_TEMPLATES` (`widget.html`).
- **Submenu** [CSV / XLSX] on the button (not single-format).
- Filename `export-{toolName}-{YYYY-MM-DD}.{csv|xlsx}` (ISO date).
- **2A**: `track_package` single-object export (no viz) — resolved client-side by deterministic parse of the `format_tracking` reply text.
- A **generic fallback template** so any future tool that emits a visualization is covered without config drift.

### Out of Scope
- **Phase 2B**: Zoho Sheets / WorkDrive fallback — excluded from this change.
- Server/Deluge changes — NONE. The export control only appears where the backend already emits a `table`/`bar` visualization.

## Capabilities

### New Capabilities
- `widget-export`: client-side download of displayed viz data as CSV (native) and `.xlsx` (SheetJS) via submenu + per-tool JSON templates; single-object export for `track_package`; generic fallback template for future tools.

### Modified Capabilities
None — widget-only addition; existing capability requirements unchanged.

## Approach
Client-side-first, no backend edits. `renderVisualization` (and `renderMessageNode` for the `track_package` text path) get an export toolbar: button opening `[CSV / XLSX]` submenu. CSV emitted natively from the `{labels, series}` shape (RFC 4180, UTF-8 BOM); XLSX via `window.XLSX`, the lazy `sheetjs` CDN script injected only on first XLSX request. Per-tool layout from `CONFIG.EXPORT_TEMPLATES`; tool name resolved from `viz.title` prefix (no tool name in the envelope); `track_package` object resolved by deterministic text parse; unknown tools fall back to a built-in generic template. ISO-date filenames; `showToast` feedback; any XLSX failure degrades to an automatic CSV download.

## Tradeoffs
- **Option C (Zoho Sheets/WorkDrive) rejected**: backend wiring + auth quotas + latency, against client-side-first; deferred as 2B.
- **CSV native Phase 1** (zero deps, universal) vs **XLSX Phase 2A** for numeric fidelity.

## Affected Areas
| Area | Impact |
|------|--------|
| `LM2Chatbot/app/widget.html` | Modified (single file) — CSS 1.8b, JS 3.5, `renderVisualization`, `CONFIG.EXPORT_TEMPLATES` |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| SheetJS CDN offline/blocked | Med | CSV stays local; graceful toast; script injected only on request |
| Template drift from backend fields | Med | Centralized in `CONFIG`; smoke-test 5 tools + tracking |
| `labels`/`series` shape mismatch | Low | Shared CSV builder from `{labels, series}`; XLSX reuses it |
| Same-day filename collisions | Low | toolName + ISO date is deterministic; fine for manual export |

## Rollback Plan
Revert `widget.html` only — no backend migration, no data changes, no Creator re-publish. Removing the toolbar restores prior rendering; SheetJS never injected unless an export is requested.

## Dependencies
SheetJS (`xlsx`) via public CDN at runtime; rest native, no new packages, no backend.
## Success Criteria
- [ ] Each `table`/`bar` viz shows an export button with working `[CSV / XLSX]` submenu
- [ ] CSV works for all 5 viz tools; `.xlsx` with correct per-tool headers/sheet
- [ ] `track_package` object export works in 2A
- [ ] Filenames `export-{toolName}-{YYYY-MM-DD}.{ext}`; toasts on result
- [ ] Widget-only diff; conversation-JSON export intact
