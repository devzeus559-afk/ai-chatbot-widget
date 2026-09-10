# Archive Report: widget-export-visualizations

**Archived**: 2026-09-10
**Change**: widget-export-visualizations
**Status**: Complete — all tasks done, verified live in Zoho Creator

## What Shipped

Added an Export control (CSV / XLSX submenu) to rendered visualizations in the chatbot widget. Export is fully client-side, zero backend coupling. Per-tool sheet templates defined in `CONFIG.EXPORT_TEMPLATES`. `track_package` exports its single data object by parsing the deterministic formatted reply text.

## Scope

- **Widget only** (`chatbot-widget/app/widget.html`): CSS, JS export logic, CONFIG templates
- **No backend changes**: no Deluge, no Creator schema, no new modules
- **No migration**: SheetJS injected lazily from CDN on first XLSX request

## Tasks

20/20 complete `[x]` including gates 3.2–3.5 (manual Creator verification by user, 2026-09-10).

## Verification

- **Static read-diff**: CSV BOM/CRLF, RFC 4180 escaping, multi-series headers, `localIsoDate` non-UTC, filename format, template lookup, `parseTrackingText`, submenu ARIA/listeners, `runExport` isolation — all confirmed.
- **Live Creator verification** (user-confirmed 2026-09-10):
  - 3.2: `report_top_customers` table/bar → CSV opens with accents in Excel; XLSX layout applied; correct filenames
  - 3.3: `track_package` → toolbar under text message (no viz) → single-row CSV/XLSX
  - 3.4: DevTools offline → XLSX toast + auto CSV fallback; conversation continues; `exportBtn` JSON export unaffected
  - 3.5: Re-open saved conversation → export intact; type `none`/missing → no control

## Known Caveats (non-blocking)

1. **Export buttons hidden unconditionally** (hardcoded hidden class at `chatbot-widget/app/widget.html` ~line 802): buttons are always hidden via CSS class, not hidden-when-no-data. User verified this as the intended design. Conditional visibility was not implemented and is not a defect.
2. **Widget directory renamed**: `LM2Chatbot` → `chatbot-widget` (commit a65e59b, 2026-09-08). Some design/tasks text and the rollback doc still reference `LM2Chatbot/` paths. The canonical current path is `chatbot-widget/`.

## Final-State Facts

Per the Final-State Authority hierarchy (most authoritative first):
1. **User-verified live**: all gates 3.2–3.5 passed in Creator on 2026-09-10. User stated "este 3er punto esta cubierto completo."
2. **Persisted tasks.md**: 20/20 `[x]` — no unchecked tasks.
3. **Verify report** (intermediate snapshot, lowest rank): verdict `pass_with_warnings`. The W1 warning (buttons hidden unconditionally vs. conditional) was resolved as intentional by user.

## Spec Sync

Domain `widget-export`: main spec `openspec/specs/widget-export/spec.md` already contained all ADDED requirements from the delta. No merge changes needed — sync was a no-op.

## Archived Contents

- `proposal.md` — scope, approach, rollback plan
- `specs/widget-export/spec.md` — delta spec (all ADDED requirements)
- `design.md` — technical design
- `tasks.md` — 20/20 complete
- `verify-report.md` — verify report (pass_with_warnings)
- `archive-report.md` — this file

## Rollback

Widget-only: `git checkout -- chatbot-widget/app/widget.html`. No backend, migration, or Creator re-publish needed.
