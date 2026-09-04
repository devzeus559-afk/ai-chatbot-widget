# Proposal: report_top_customers — Top Customer Frequency Report

## Intent
The widget chatbot cannot answer metric questions ("lista los 10 clientes más frecuentes en el servicio paquetería"): the catalog declares only 5 lookup tools. Add a 6th metric tool `report_top_customers` ranking customers by service frequency over the last 30 days, mirroring the zia_tools.reportTopCustomers pattern without copying its code.

## Scope

### In Scope
- New `deluge/tools/tool_report_top_customers.deluge` (0 API calls).
- Date-window Service helpers in `data_access.deluge`; reuses `fetch_services_ids_by_type`, `fetch_services_by_ids`, `fetch_contacts_by_ids`.
- Optional `serviceType` filter (exact picklist casing); fixed 30-day window on `Date_field1`.
- Frequency-only ranking (default top-10); Spanish template reply via `compose_reply`; `composeWithAI` stays false.
- Wiring: catalog entry + `senderField` map in `chat_config`, `dispatch_tool` branch, `format_top_customers`.
- Amend `config.yaml` 5-tools rule.

### Out of Scope
Configurable window, value/amount aggregation, trend vs previous period, PII/LLM composition (`composeWithAI`), exact ranking beyond the 200-record cap.

## Capabilities

### New Capabilities
- `report-tools`: metric/reporting tools answering "top N" questions (first instance `report_top_customers`).

### Modified Capabilities
- `data-access-layer`: adds date-window Service helpers (count / IDs / windowed fetch).

## Business Rules
- `serviceType` optional, case-sensitive; exact values: Package Receipt, Locker, Store, Remittance, Recharge, Online Store, Other Services ("paquetería" = "Package Receipt").
- Fixed 30-day window on `Date_field1`; not configurable this slice.
- Metric = COUNT only; no amount aggregation.
- No trend fields this slice.
- Empty `Sender_field` ignored; ties → earliest service date ranks first; top-10 default; cap 200 + `truncated` flag (open question: zia uses 500).

## Functional Requirements
- MUST: register in catalog; description enumerates exact `serviceType` values.
- MUST: count-first, cap 200 with `truncated: true`.
- MUST: skip null `Sender_field`; normalize sender IDs to Number; `toNumber()` on `limit` (default 10).
- MUST: tie-break by earliest date; resolve names only for top-N via `fetch_contacts_by_ids`.
- SHOULD: keep `composeWithAI` false (names never sent to LLM).

## Approach
Mirror zia_tools.reportTopCustomers: count window → fetch `range 0 to 199` + `truncated` when >200 → aggregate per sender → top-N insertion sort O(n·limit) → batch name resolution → `{ok, data}`. With `serviceType`: IDs-by-type ∩ IDs-by-date-window → `fetch_services_by_ids`. Literal field names only (gate 5.1).

## Affected Areas
| Area | Impact |
|------|--------|
| `deluge/tools/tool_report_top_customers.deluge` | New |
| `deluge/core/data_access.deluge` | Modified |
| `deluge/config/chat_config.deluge` | Modified |
| `deluge/core/chat_invoke.deluge` | Modified |
| `deluge/core/chat_common.deluge` | Modified |
| `deluge/README.md` | Modified |
| `openspec/config.yaml` | Modified |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `serviceType` case drift → silent empty result | Med | Description lists exact values; empty param = no filter |
| Sender ID type drift breaks `Contacts[ID in ids]` | Med | Normalize to Number before resolution |
| Zia sends `limit` as string | Med | `toNumber()` + default 10 |
| 4-6 native queries vs 40s Zia budget | Med | 200 cap, single batch resolution, Creator smoke test |
| Truncated ranking >200 (vs zia 500) | Med | `truncated` flag + reply notice; design open question |
| config rule contradicts 6th tool | Low | Rule amended in this change |

## Rollback Plan
Git revert + re-publish workflow code in Creator. Tool is inert when unregistered: removing the catalog entry + dispatch branch restores the 5-tool catalog; per-file commits allow targeted rollback.

## Dependencies
Same Creator app (verified); manual Creator smoke test before publish.

## Success Criteria
- [ ] "10 clientes más frecuentes en paquetería" → ranked list with counts + type breakdown
- [ ] Omitted `serviceType` counts all types; exact casing required
- [ ] No trend/amount fields; window fixed; ties by seniority
- [ ] `truncated` notice when >200; 0 API calls; `composeWithAI` false
- [ ] config.yaml rule amended
