# Design: report_top_customers — Top Customer Frequency Report

## Technical Approach

Add a 6th, metric tool `report_top_customers` that ranks customers by service frequency over a **fixed 30-day window** on `Date_field1` (business date), with an optional exact-casing `serviceType` filter. It mirrors the zia_tools.reportTopCustomers algorithm (count-first → windowed fetch → per-sender aggregation → top-N insertion sort → batch name resolution) without copying its code, adapted to this project's constraints: **200-record cap** (not zia's 500), **no `days` param** and **no trend** (out of scope per proposal). 0 API calls, `composeWithAI` false, Spanish template reply. Per specs `report-tools` (new domain) and `data-access-layer` (delta) — source of truth.

## Constraints (Zoho Creator limits)

| Constraint | Impact on this design |
|---|---|
| Zia task timeout 40s; widget polls Status every 1.5s / 45s timeout | 3–5 native queries per turn max (see Zia 40s Budget) |
| getRecords documented max 200; project cap 200/fetch | Window fetch capped `range from 0 to 199`; `truncated` flag when count > 200 |
| No global Deluge state | Every function starts `config = chat_config();` |
| Gate 5.1: `Form[criteriaVar]` invalid; field names must be literals | Inline range on ONE field `Date_field1` with variable values; type filter via ID-list intersect |
| `Service[ID in []]` behavior unknown | Empty-intersection guard → `customers: []` without final fetch |

## Architecture Decisions

### Decision: 200-record cap RESOLVED (spec over proposal's open 500 question)

| Option | Tradeoff | Decision |
|---|---|---|
| Cap 500 (mirror zia) | Exceeds documented getRecords max (200) and project convention | Rejected |
| Cap 200 + `truncated` flag | Approximate ranking on windows > 200; spec mandates this (`report-tools` "200-Record Cap") | Chosen — spec is authoritative |

`truncated` means: the window's exact count (native `.count(ID)`) exceeds 200, so the ranking is computed from the first 200 fetched records and is **approximate**; the reply shows a notice. **Assumption**: `range from 0 to 199` cannot return > 200 records by construction, and `.count(ID)` is exact. Whether the native range window could ever exceed 200 is unverifiable locally → Creator smoke-test check in verify phase (seed > 200 services in a window, confirm `truncated: true` and ≤ 200 records processed).

### Decision: Count-first + windowed fetch (range syntax)

`Service[Date_field1 >= startDate && Date_field1 <= endDate]` — literal field name, variable values; **2 conditions on ONE field = a range**, the same inline pattern proven by the other project's live code in this same app (exploration verified). Count helper feeds `truncated`; fetch helper caps at 200.

### Decision: Type filter via ID-list intersect (not inline AND)

| Option | Tradeoff | Decision |
|---|---|---|
| Inline `Date_field1 >= s && Date_field1 <= e && Service_Type == t` | Two different fields → 3 conditions; deviates from project's 2+ condition ID-list pattern | Rejected |
| `windowIDs.intersect(typeIDs)` → `fetch_services_by_ids` | Reuses `fetch_services_ids_by_type` and the existing ID-list pattern; `targetIDs.size()` gives the **exact** filtered count → `truncated` is precise for the filtered path with no extra query | Chosen |

### Decision: Fixed 30-day window, no `days` param, no trend

Proposal/specs are explicit: window never configurable (`endDate = zoho.currentdate; startDate = endDate.subDay(30)`), trend vs previous period out of scope. This also saves 2 native queries vs exploration's trend variant.

### Decision: Baked range in the windowed fetch helper

`fetch_services_by_date_window(start, end)` bakes `sort by Date_field1 range from 0 to 199` — follows the project's baked-range convention (e.g. `fetch_contacts_by_ids` 0-49) and the spec's fixed 200 cap; simpler contract than exploration's parametrized `(start, end, from, to)`.

### Decision: Response-read field maps extended, not literals in the tool

The tool reads `Sender_field` and `Date_field1` per record via `fields.get(...)` (valid Map.get on record attributes). Add `sender → "Sender_field"` and `date → "Date_field1"` to `serviceFields` in `chat_config` — keeps field-name coupling at the same documented points (data_access literals + config maps), matching `tool_contacts`' composite-subfield read pattern.

### Decision: composeWithAI stays false

Ranking contains customer names + counts (PII-adjacent). Template composition means raw ranking data is never sent to the LLM (per spec "Spanish Template Reply, No LLM Composition"). The catalog description guides Zia to pick the tool; no second Zia call.

## Data Flow (per turn)

```
chat_invoke → resolve_reply → dispatch_tool("report_top_customers", params)
  tool_report_top_customers(params)
    unfiltered: count(1) ──▶ windowed fetch ≤200(2) ──▶ aggregate ──▶ top-N ──▶ names(3)
    filtered:   count(1) + windowIDs(2) + typeIDs(3) ──▶ intersect ──▶ fetch by IDs(4) ──▶ aggregate ──▶ top-N ──▶ names(5)
  → compose_reply (composeWithAI=false) → format_top_customers(data) → Spanish template
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `deluge/tools/tool_report_top_customers.deluge` | Create | New metric tool (mirror algorithm, 0 API calls) |
| `deluge/core/data_access.deluge` | Modify | +3 date-window Service helpers; header count 25 → 28 |
| `deluge/config/chat_config.deluge` | Modify | Catalog entry + `serviceFields` sender/date keys |
| `deluge/core/chat_invoke.deluge` | Modify | `dispatch_tool` branch |
| `deluge/core/chat_common.deluge` | Modify | `compose_reply` branch + `format_top_customers`; header |
| `deluge/README.md` | Modify | Function tables (data_access + tools) |
| `openspec/config.yaml` | Modify | Amend 5-tools proposal rule (see Config Amendment) |

## Interfaces / Contracts

```deluge
// data_access.deluge (each fn starts config = chat_config();)
Number fetch_services_count_by_date_window(Date startDate, Date endDate)
  // Service[Date_field1 >= startDate && Date_field1 <= endDate].count(ID)
List   fetch_services_ids_by_date_window(Date startDate, Date endDate)
  // Service[Date_field1 >= startDate && Date_field1 <= endDate].ID.getAll()
List   fetch_services_by_date_window(Date startDate, Date endDate)
  // Service[Date_field1 >= startDate && Date_field1 <= endDate] sort by Date_field1 range from 0 to 199

// tool_report_top_customers(Map params)
// params: {serviceType?: string (exact picklist), limit?: string|number (default 10)}
// returns: {"ok": true, "data": {
//   reportType: "top_customers", periodStart, periodEnd, serviceType (null when unfiltered),
//   totalServices, totalCustomers, truncated,
//   customers: [{rank, customerId (Number), customerName, totalServices,
//                firstServiceDate, serviceBreakdown ("Type: n, Type: n")}]}}

// formatter
String format_top_customers(Map data)   // chat_common; renders template below
```

## Algorithm (tool_report_top_customers)

1. `config = chat_config();` (mandatory first line); `fields = config.get("serviceFields")`.
2. `serviceType = params.get("serviceType")` — null/"" → no filter (spec).
3. `limit = params.get("limit")` — null/""/`toNumber() <= 0` → 10 (Zia may send strings).
4. `endDate = zoho.currentdate; startDate = endDate.subDay(30)` — fixed window.
5. **Count-first / fetch**:
   - Unfiltered: `total = fetch_services_count_by_date_window(...)`; `truncated = total > 200`; `records = fetch_services_by_date_window(...)`.
   - Filtered: `windowIDs`, `typeIDs`; empty-guard each → `customers: []`; `targetIDs = windowIDs.intersect(typeIDs)`; empty → `customers: []`; `truncated = targetIDs.size() > 200`; `records = fetch_services_by_ids(targetIDs)`.
6. **Aggregate per sender** (Map keyed by `"" + senderId`): skip records with null/"" `Sender_field`; normalize `senderId = toNumber(...)`; per sender keep `count`, **earliest `Date_field1`** (seniority tie-break), and `breakdown[Service_Type]` counts with `"Other"` fallback for empty type (zia convention).
7. **Top-N insertion sort O(n·limit), no full sort**: scan current ranking for the entry's position (count desc; tie → earliest firstServiceDate first); insert there (Deluge `List.add(index, entry)`; fallback shift-copy helper if the editor rejects the indexed add — flagged for Creator smoke test); if `ranking.size() > limit` → `ranking = ranking.subList(0, limit)`.
8. **Names (top-N only)**: collect unique Number IDs → `fetch_contacts_by_ids(ids)` (0-49 window; top-N ≤ 10 fits); build fullName from `First_Name` subfields (first_name/last_name, `tool_contacts` pattern); `"Unknown"` fallback.
9. Build `data` map; return `{"ok": true, "data": ...}`.

## Spanish Reply Template (format_top_customers)

```
Clientes más frecuentes (últimos 30 días):
1. {customerName} — {totalServices} servicios ({serviceBreakdown})
2. {customerName} — {totalServices} servicios ({serviceBreakdown})
...
{si truncated}
Nota: el ranking es aproximado (se analizaron los primeros 200 servicios).
{/si}
```
Empty: `No encontré servicios en los últimos 30 días.` Breakdown line omitted when empty; `serviceBreakdown` e.g. `Package Receipt: 6, Locker: 2`.

## Wiring Points

| File | Change |
|---|---|
| `chat_config.deluge` | After `find_contacts` entry: `tool.put("name","report_top_customers")`; description enumerates the 7 exact values — "Reporte de los clientes más frecuentes (top N) por cantidad de servicios en los últimos 30 días. Filtro opcional de tipo de servicio (valores exactos, sensibles a mayúsculas): Package Receipt, Locker, Store, Remittance, Recharge, Online Store, Other Services."; `params: {"serviceType":"string opcional","limit":"string opcional"}`. `serviceFields` +`sender`/`date` keys. |
| `data_access.deluge` | 3 helpers above; update `Funciones (25)` header → (28) |
| `chat_invoke.deluge` | `if (toolName == "report_top_customers") { return tool_report_top_customers(params); }` before unknown-tool fallback |
| `chat_common.deluge` | `if (toolName == "report_top_customers") { return format_top_customers(data); }` in `compose_reply`; add `format_top_customers`; header list |
| `deluge/README.md` | `data_access` function row + new tools row/table |
| `openspec/config.yaml` | Rule amendment below |

## Zia 40s Budget

Per turn (native queries only, no API calls): **3 unfiltered** (count, windowed fetch, names) / **5 with `serviceType`** (count, windowIDs, typeIDs, fetch by IDs, names). Each is a single native fetch ≤ 200 records — well inside the 40s budget for typical volumes; smoke-tested in Creator (large Service table).

## Config Amendment (openspec/config.yaml)

```yaml
# proposal rule, OLD:
- Keep scope aligned with the 5 business tools (track_package, services, offices, coverage, contacts)
# NEW:
- Keep scope aligned with the business tools catalog: 5 lookup tools (track_package, search_services, find_offices, check_coverage, find_contacts) + metric/reporting tools (report_top_customers)
```

## Gate 5.1 Compliance

```deluge
// Range on ONE field — literal field name, variable values (valid, proven in-app):
Service[Date_field1 >= startDate && Date_field1 <= endDate].count(ID)
Service[Date_field1 >= startDate && Date_field1 <= endDate] sort by Date_field1 range from 0 to 199
// Existing equality + ID-list patterns reused unchanged:
Service[Service_Type == serviceType].ID.getAll()
Service[ID in targetIDs] sort by Service_ID range from 0 to 199
```
No criteria-string variable anywhere; `*Fields` maps only for response reads.

## Testing Strategy

No local runner — Creator smoke checks before publish:

| Layer | What to Test | Approach (Creator) |
|---|---|---|
| data_access | 3 helpers: count/IDs/fetch match, sort, ≤ 200 | Run each helper with a known window |
| tool | Unfiltered + filtered reports; `serviceType` exact casing; empty Sender skipped; ties by earliest date; `limit` string coercion; empty window | Param combos on seeded data |
| tool | **Cap assumption**: window > 200 services → `truncated: true`, ≤ 200 records processed | Seed 250 services; verify flag + count (verify-phase open question) |
| tool | `List.add(index, entry)` acceptance in the Creator editor | Static paste + one ranked run; fallback shift-copy helper if rejected |
| end-to-end | Widget turn "lista los 10 clientes más frecuentes en el servicio paquetería" → ranked reply with breakdown | Full chat_invoke run |

## Migration / Rollout

No data migration. Publish order: `data_access` → `chat_config` → `tool_report_top_customers` → `chat_invoke`/`chat_common` → README; smoke test before each publish. Rollback: per-file git revert + re-publish prior code; tool is inert when the catalog entry + dispatch branch are removed (restores 5-tool catalog).

## Open Questions

- [x] **(a) 200 vs 500 cap — RESOLVED**: 200 + `truncated` per spec; assumption (native range ≤ 200) is a verify-phase Creator smoke test.
- [ ] **(b) Runtime checks (Creator, verify phase)**: `Service[Date_field1 >= s && Date_field1 <= e]` executes with Date variables in the editor; `List.add(index, value)` accepted (else shift-copy helper); Sender ID surfaces as Number on native fetch (normalization still applied).

## Risks

| Risk | Mitigation |
|---|---|
| `serviceType` case drift → silent empty result | Description lists exact values; null/"" param = no filter; smoke test exact casing |
| Sender ID type drift breaks `Contacts[ID in ids]` | Normalize `toNumber()` before name resolution |
| Approximate ranking when window > 200 | `truncated` flag + reply notice; exactness beyond cap is out of scope (proposal) |
| Indexed list insert unsupported by editor | Fallback shift-copy helper; smoke check |
| Field-literal drift (`Date_field1`/`Sender_field` in data_access vs config map) | Documented coupling; single smoke per helper |
