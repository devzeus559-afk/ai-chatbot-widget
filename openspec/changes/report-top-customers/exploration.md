# Exploration: report_top_customers

## Current State

The custom widget chatbot (Zoho Creator app `copy-1-of-logistic-management-ii`) cannot answer metric/reporting questions ("lista los 10 clientes más frecuentes en el servicio paquetería") because the tool catalog in `deluge/config/chat_config.deluge` declares only 5 lookup tools (`track_package`, `search_services`, `find_offices`, `check_coverage`, `find_contacts`) and `dispatch_tool` routes only those. The native Zoho chat owns a `zia_tools` module (`reportTopCustomers`, `reportInactiveCustomers`, `resolve*NamesBatch`, …) in the SAME live app (dump lines ~14804-15167) but that module belongs to the native-chat project and is NOT reused (decision already made). Facts verified against `Logistic_Management_II (1).ds` (44788 lines) and the widget Deluge sources:

### Service form schema (dump, form at line 5090)
- `Service_Type` — picklist, values = `{"Package Receipt","Locker","Store","Remittance","Recharge","Online Store","Other Services"}`, initial value `"Package Receipt"` (lines 5105-5106). **Exact casing for paquetería: `"Package Receipt"`** (case-sensitive equality; Zia must emit it verbatim).
- `Date_field1` — `type = date`, displayname "Date", must-have, initial `${zoho.currentdate}` (lines 5176-5185). **This is the service date used by the report** (not Created_Time).
- `Sender_field` — picklist → Contacts, `values = Contacts[Type_field == "Sender" || Type_field == "Sender & Receiver" && Active == true].ID`, `displayformat = [Mobile + "- " + First_Name.first_name + " " + First_Name.last_name]` (lines 5195-5209). Returns the Contact ID on a native fetch (stringified in the other project).
- `Created_Time` — system field present on Service (dump line 14807 lists it); NOT needed: the report windows on `Date_field1` (business date).

### zia_tools.reportTopCustomers pattern (dump lines 15010-15167 — mirror, do NOT copy)
1. Params `days` (default 15), `limit` (default 10); `MAX_RECORDS = 500`.
2. `endDate = zoho.currentdate; startDate = endDate.subDay(days)`.
3. Count first: `Service[Date_field1 >= startDate && Date_field1 <= endDate].count(ID)`; if count > MAX_RECORDS → fetch `range from 0 to MAX_RECORDS - 1` + `truncated = true`, else fetch all.
4. Aggregate per `Sender_field`: count per sender + service-type breakdown map (`"Other"` fallback for empty `Service_Type`).
5. Batch name resolution in ONE query (`resolveContactNamesBatch` → `Contacts[ID in ids]` → Map<id, fullName>, `"Unknown"` fallback).
6. Top-N via **insertion sort O(n·limit)** (append + `subList` truncation to `limit`), not full sort.
7. Output per customer: `{rank, customer_id, customer_name, total_services, service_breakdown (string "Type: n, Type: n"), period_days}`.
8. Trend vs previous period: `prevStartDate = startDate.subDay(days)`; count in `[prevStartDate, startDate)`; `trendPercent = (total - prev)*100/prev` (guard prev > 0); `trendDirection = up|down|stable`.
9. Summary collection: `{report_type, period_start, period_end, total_services, total_customers, trend_percent, trend_direction, truncated, prev_truncated, customers}`.

Note: the native-chat prompt (dump line 11179) shows "Services in a date range: `Service[Created_Time >= …]`" but the actual function uses `Date_field1` — mirror the FUNCTION (`Date_field1`).

### Existing native helpers (deluge/core/data_access.deluge) — reuse, don't duplicate
- `fetch_services_ids_by_type(String serviceType)` → `Service[Service_Type == serviceType].ID.getAll()`
- `fetch_services_by_ids(List ids)` → `Service[ID in ids] sort by Service_ID range from 0 to 199`
- `fetch_services_all()` → `Service[ID != 0] sort by Service_ID range from 0 to 199`
- `fetch_contacts_by_ids(List ids)` → `Contacts[ID in ids] sort by First_Name range from 0 to 49` (acts as our batch name resolver; only the top-N ≤ limit ≤ 10 contacts need resolution, inside the 0-49 window)
- `fetch_contacts_all()` → `Contacts[ID != 0] sort by First_Name range from 0 to 49`
- **NO date-window helper exists** — the new tool needs one (see Approaches). Gate 5.1 stands: no criteria-string variables; an inline range on ONE field with literal field name + variable values (`Date_field1 >= startDate && Date_field1 <= endDate`) is compliant (proven by the other project's live code in this same app).

### Tool registration + dispatch + compose (verified)
- `chat_config.deluge` — tools catalog: `{name, description, params}` maps; `toolsText` auto-built and injected into the Zia prompt by `chat_intent.deluge`. `serviceFields` currently maps only `name → Service_ID`, `type → Service_Type` (no sender field mapping yet).
- `chat_invoke.deluge` — `dispatch_tool` if/else chain over the 5 tools + `{"ok": false, "message": "Herramienta desconocida: ..."}` fallback.
- `chat_common.deluge` — `compose_reply(toolResult, intent)` contract: `{ok: true, data}` / `{ok: false, message}`; switches on `intent.get("tool")` to a formatter. Existing formatters render **Spanish text lines** (chat serves Spanish-speaking customers; templates like "No encontré…"). A `format_top_customers` branch is needed.
- Tool boilerplate (every tool file): `config = chat_config();` first; `fields = config.get("…Fields")`; ID-list pattern (`addAll`/`intersect`, empty-guard before `Form[ID in []]`); returns `{"ok": true, "data": …}`.

### Constraints (config.yaml + README + Zoho docs)
- Zia task timeout 40s; widget polls Status every 1.5s with 45s timeout.
- Native windows in this project: business lists `range 0 to 199` (200), contacts `0 to 49`, history `0 to 9`. `zoho.creator.getRecords` documented max 200 — the project's documented cap is 200 per fetch.
- No global Deluge state; every Deluge function starts with `config = chat_config();`.
- snake_case Deluge functions; Spanish-neutral comments; reply templates follow existing Spanish formatters; English UI strings (widget).
- Gate 5.1: `Form[criteriaVar]` invalid; literal field names + variable values; ID-list pattern for 2+ AND conditions.
- config.yaml proposal rule "Keep scope aligned with the 5 business tools" MUST be amended (this change adds a 6th, metric tool) — proposal phase must update it.

## Affected Areas
- `deluge/config/chat_config.deluge` — register 6th tool `report_top_customers` (name/description/params; description must list valid `serviceType` values incl. exact `"Package Receipt"`); optionally add `senderField → "Sender_field"` to `serviceFields`.
- `deluge/core/data_access.deluge` — add date-window helpers for Service (count + windowed fetch; optionally IDs-by-date for combining with serviceType).
- `deluge/core/chat_invoke.deluge` — add `report_top_customers` branch in `dispatch_tool`.
- `deluge/core/chat_common.deluge` — add `format_top_customers` branch in `compose_reply` + formatter (Spanish template, ranking + trend).
- `deluge/tools/tool_report_top_customers.deluge` — NEW tool (mirror zia_tools algorithm; reuse data_access helpers; 0 API calls).
- `deluge/README.md` — function table + folder docs (new Creator function must be created + documented).
- `openspec/config.yaml` — amend the "5 business tools" scope rule.
- `openspec/specs/lookup-tools/spec.md` (or a new metrics capability spec) — future spec/design phases extend it.

## Approaches

1. **Dedicated native tool `tool_report_top_customers` (mirror zia_tools pattern)** — new file in `deluge/tools/` + data_access date-window helpers + catalog/dispatch/compose wiring + README/config rule updates. Params: `days` (default 15), `limit` (default 10), `serviceType` (optional; exact picklist casing). Capped at **200** records per window with `truncated: true` (project cap, not the other project's 500). Batch-resolve names only for top-N via `fetch_contacts_by_ids`. Trend vs previous window included.
   - Pros: matches the user decision; mirrors a proven live pattern; 0 external/API calls; reuses existing helpers and conventions; keeps metric logic isolated from lookup tools.
   - Cons: touches 5 Deluge files + README + config rule; ranking is approximate when window > 200 records (truncated flag); adds a schema-coupled helper (Date_field1/Sender_field literals must match the `*Fields` maps).
   - Effort: Medium

2. **Extend `tool_services` with a report mode** — reuse its existing Service access inside one tool.
   - Pros: fewer files touched.
   - Cons: violates single-responsibility; mixes catalog listing with aggregation; dispatch/compose branching gets convoluted; worse review/rollback story. 
   - Effort: Low-Medium

3. **Paged full-scan ranking (exact for > 200 records)** — loop `range from` windows in 200-record chunks until the window is fully scanned or a page cap.
   - Pros: exact ranking on large windows.
   - Cons: more native queries per turn → risk against the 40s Zia budget; complexity. Only worth it if exactness on large windows is a hard requirement.
   - Effort: Medium-High

4. **Port `resolveContactNamesBatch`-style helper into data_access** — unnecessary: `fetch_contacts_by_ids` already does batch `Contacts[ID in ids]` name resolution; only the top-N (≤ 10) contacts need names.
   - Effort: Low (rejected as redundant)

## Recommendation

**Approach 1.** Create `deluge/tools/tool_report_top_customers.deluge` mirroring the zia_tools algorithm with the project's conventions:
- Params `days` (default 15), `limit` (default 10), `serviceType` optional — the user example "en el servicio paquetería" REQUIRES the optional `serviceType` filter with exact casing `"Package Receipt"`; without it the tool would mix all service types.
- Add to data_access: `fetch_services_count_by_date_window(start, end)`, `fetch_services_by_date_window(start, end, from, to)`, and `fetch_services_ids_by_date_window(start, end)` (for ID-list intersect with `fetch_services_ids_by_type` when `serviceType` is present).
- Cap at 200 records/window (project constraint) with `truncated: true`; aggregate per `Sender_field`; top-N insertion sort O(n·limit); batch-resolve names via `fetch_contacts_by_ids` for the top-N IDs; compute trend vs the previous window of equal length.
- Wire: catalog entry in `chat_config` (description must enumerate valid `serviceType` values with exact casing), `dispatch_tool` branch, `compose_reply` + `format_top_customers` (Spanish template: ranking, counts, breakdown, trend, truncation notice).
- Normalize `Sender_field` IDs to Number before building the list for `Contacts[ID in ids]`; coerce `days`/`limit` params with `toNumber()` before use; empty `Sender_field` records are skipped.

## Risks
- **Record cap discrepancy**: zia_tools uses `MAX_RECORDS = 500` with `range from 0 to 499`; this project documents 200 max per fetch (and the native API docs cap at 200). Whether a single native range window can return > 200 records is unverified — cap at 200 + `truncated: true` and flag this as an open question for design (option 3 exists if exactness on big windows becomes required).
- **`serviceType` casing**: `Service_Type == "Package Receipt"` is case-sensitive; if Zia emits a variant (e.g. "paquetería", "Package receipt") the filter silently returns nothing. Mitigate with the catalog description listing exact values and a default no-filter when the param is missing/empty.
- **Sender ID type drift**: native fetch lookup attributes may surface as Number or String; wrong type breaks `Contacts[ID in ids]` (gate 5.1 ID-list). Normalize to Number in the tool before the final fetch.
- **Zia param typing**: `days`/`limit` may arrive as strings; `endDate.subDay(days)` needs a Number — coerce defensively; defaults 15/10 when null/<=0.
- **Timeout**: 4-6 native queries per turn (count + window for current and previous periods + optional type intersect + contact resolution). Fine for typical volumes, but large tables with the trend query must be smoke-tested in Creator (40s budget).
- **Approximate ranking on big windows**: > 200 services in the window → truncated ranking; the reply must state the limitation (as zia_tools' `truncated` flag implies).
- **Config rule conflict**: `config.yaml` proposal rule scopes to "the 5 business tools" — the proposal MUST amend it or it self-contradicts this approved change.
- **PII**: report returns customer names + counts; `composeWithAI` defaults false (template composition) so raw ranking data is not sent to the LLM; keep it that way for this tool or note the exposure in the design.

## Ready for Proposal

**Yes.** The orchestrator should tell the user: exploration confirmed the schema facts (Service_Type exact values incl. `"Package Receipt"`, `Date_field1` service date, `Sender_field` → Contacts), mapped the zia_tools.reportTopCustomers algorithm (count-first, 500-cap, per-sender aggregation, O(n·limit) top-N insertion sort, batch name resolution, previous-period trend) and the widget's existing native helpers to reuse (`fetch_services_*`, `fetch_contacts_by_ids` for batch name resolution). Recommended approach: a new `tool_report_top_customers` (Approach 1) with an optional `serviceType` filter (needed for "en el servicio paquetería"), 200-record cap + truncated flag (project constraint, NOT the other project's 500), Spanish template reply, and the standard wiring (catalog, dispatch, compose). Proposal must also amend the "5 business tools" rule in `openspec/config.yaml` since this change adds a 6th tool.
