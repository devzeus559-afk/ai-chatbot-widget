# Archive Report: report-top-customers

**Archived**: 2026-09-10
**Change**: report-top-customers
**Status**: Complete — all phases passed, verified live in Creator

## Summary

Implemented `report_top_customers`, a metric/reporting Deluge tool that ranks customers by service frequency over a fixed 30-day window. This is the project's first metric tool (6th tool total), registered alongside the 5 existing lookup tools.

## What Was Delivered

- **3 date-window Service helpers** added to `deluge/core/data_access.deluge` (count, fetch, IDs)
- **1 new tool file**: `deluge/tools/tool_report_top_customers.deluge` (not `deluge/core/`)
- **Catalog + dispatch wiring** in `chat_config.deluge` and `chat_invoke.deluge`
- **Spanish template reply** via `format_top_customers` in `chat_common.deluge`
- **Config rule amendment**: `openspec/config.yaml` proposal rule extended to include metric tools
- **Documentation**: `deluge/README.md` function tables updated

## Verification Evidence

| Gate | Date | Result |
|------|------|--------|
| Smoke suite (`tests_report_top_customers.run()`) | 2026-09-09 | 22/22 PASSED in live Creator |
| E2E widget turn (Store query) | 2026-09-10 | Ranking returned, window 897 → cap 200 verified |
| Failure path (Status→failed) | 2026-09-10 | Verified |
| Gate 6.1 (a)–(g) | 2026-09-10 | All manual Creator checks passed |

Verdict from `verify-report.md`: **pass_with_warnings** (validated, sha256 `7b1b0f12f1ad4dc40447dceb459fd4d9d67b22604aa5df21d8c57bb9443469e5`)

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `data-access-layer` | Updated | 3 ADDED requirements (Date-Window Service Count, Date-Window Service Fetch, Date-Window Service IDs) appended to existing spec |
| `report-tools` | Created | New domain; 6 requirements (Catalog Registration, Dispatch Routing, Fixed 30-Day Window, Frequency Ranking, 200-Record Cap, Spanish Template Reply, Scope Rule Amendment) |

## Archive Contents

- `proposal.md` ✅
- `specs/data-access-layer/spec.md` ✅ (delta)
- `specs/report-tools/spec.md` ✅ (delta)
- `design.md` ✅
- `tasks.md` ✅ (17/17 tasks complete)
- `verify-report.md` ✅
- `exploration.md` ✅

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived.
Ready for the next change.
