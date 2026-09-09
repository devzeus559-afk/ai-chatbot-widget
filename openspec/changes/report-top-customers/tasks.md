# Tasks: Top Customer Frequency Report (report_top_customers)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~280–360 (7 files: tool ~180, data_access ~35, chat_common ~55, chat_config ~20, chat_invoke ~5, README ~15, config.yaml ~2) |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR; 3 work-unit commits |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units (single PR, one commit per unit)

| Unit | Commit | Goal | Notes |
|------|--------|------|-------|
| 1 | `feat(deluge): add date-window Service helpers to data_access` | 3 date-window helpers + header 25→28 | Foundation; self-contained helpers |
| 2 | `feat(deluge): add report_top_customers tool with catalog and dispatch wiring` | tool file + catalog entry + serviceFields keys + dispatch + compose/format + README tables | Feature end-to-end; rollback = revert this commit (restores 5-tool catalog) |
| 3 | `docs(openspec): extend proposal scope rule to metric tools` | `openspec/config.yaml` rule amendment | Independent |

## Phase 1: Foundation — date-window helpers (`deluge/core/data_access.deluge`)

- [x] 1.1 Add `Number fetch_services_count_by_date_window(Date startDate, Date endDate)` — `Service[Date_field1 >= startDate && Date_field1 <= endDate].count(ID)`; 0 when null (spec "Date-Window Service Count"). Smoke (Creator): known window → count matches.
- [x] 1.2 Add `List fetch_services_ids_by_date_window(Date startDate, Date endDate)` — `Service[Date_field1 >= ... && Date_field1 <= ...].ID.getAll()`. Smoke: IDs match window.
- [x] 1.3 Add `List fetch_services_by_date_window(Date startDate, Date endDate)` — `sort by Date_field1 range from 0 to 199` (spec "Date-Window Service Fetch"; scenarios under/over cap). Smoke: window 150 → 150; window 250 → 200.
- [x] 1.4 Update header comment `Funciones (25)` → `(28)` + list new helpers. Smoke: static review.

## Phase 2: Core — new tool (`deluge/tools/tool_report_top_customers.deluge`, create)

- [x] 2.1 Create file with contract header: params `{serviceType: List<string> obligatorio ≥1, limit?}` (default 10), returns `{"ok": true, "data": {...}}` o `{"ok": false, "kind": "clarify"}` si falta tipo; 0 API calls, `config = chat_config();` first line.
- [x] 2.2 Window + fetch: fixed 30-day window (`endDate = zoho.currentdate; startDate = endDate.subDay(30)`); union de IDs por tipo (`addAll`) → `windowIDs.intersect(typeIDs)` (empty-guard cada uno; empty intersection → `customers: []`), `truncated = targetIDs.size() > 200`, `fetch_services_by_ids` (specs "Fixed 30-Day Window" + "200-Record Cap"). Sin modo unfiltered: tipo ausente/vacío/no-lista → clarify.
- [x] 2.3 Aggregate per sender: skip null/"" `Sender_field`; `senderId = toNumber(...)`; keep count, earliest `Date_field1` (seniority tie-break), `breakdown[Service_Type]` with "Other" fallback (spec "Frequency Ranking"; scenario "Empty sender ignored").
- [x] 2.4 Top-N insertion sort O(n·limit): shift-copy fallback helper `insert_ranked_entry` (Deluge `List.add()` is append-only — no indexed insert exists; verified against official docs); trim `ranking.subList(0, limit)`; ties → earliest date first (scenario "Tie ranked by seniority").
- [x] 2.5 Names (top-N only): unique Number IDs → `fetch_contacts_by_ids`; fullName from `First_Name` subfields (tool_contacts pattern); "Unknown" fallback. Build `data` (reportType, periodStart/End, serviceType joined ", ", totalServices, totalCustomers, truncated, customers[]) and return `{"ok": true, "data": ...}`.
- [ ] 2.6 Smoke: Creator runs — single-type + multi-type union + exact-casing `serviceType` + clarify (ausente/vacío/no-lista) + `limit` as string. ⏳ (pendiente — smoke manual en Zoho Creator, fase de verificación 6.1)

## Phase 3: Integration / Wiring

- [x] 3.1 `chat_config.deluge` — catalog entry after `find_contacts`: name `report_top_customers`; description enumerates the 5 exact picklist values del dominio genérico (Locker, Store, Recharge, Online Store, Other Services), `serviceType` como lista obligatoria, clarify si falta, y regla de routing (paquetería → `report_top_package_customers`; remesas → `report_top_remittance_customers`) (spec "Catalog Registration"; scenarios). Smoke: Zia intent "lista los 10 clientes más frecuentes en el servicio Locker" → tool + `serviceType: ["Locker"]`.
- [x] 3.2 `chat_config.deluge` — `serviceFields` + `sender → "Sender_field"`, `date → "Date_field1"`. Smoke: static.
- [x] 3.3 `chat_invoke.deluge` — dispatch branch `if (toolName == "report_top_customers") { return tool_report_top_customers(params); }` before unknown-tool fallback (spec "Dispatch Routing"; scenario "Unknown tool fallback preserved"). Smoke: static + dispatch run.
- [x] 3.4 `chat_common.deluge` — `compose_reply` branch + `format_top_customers` (Spanish template, truncation notice, empty reply, breakdown omitted when empty) + header list (spec "Spanish Template Reply"). Smoke: reply renders per design template (unfiltered/filtered/empty/truncated).

## Phase 4: Config rule

- [x] 4.1 Amend `openspec/config.yaml` proposal rule "5 business tools" → "5 lookup tools + metric/reporting tools (report_top_customers)" (spec "Scope Rule Amendment"; design Config Amendment). Smoke: static.

## Phase 5: Docs

- [x] 5.1 `deluge/README.md` — function tables: `data_access` row + 3 date-window helpers; `tools` row + `tool_report_top_customers` (+ helpers `insert_ranked_entry`, `build_empty_report`); folder-structure line; 200-cap/truncated note. Smoke: static review vs design Interfaces.

## Phase 6: Manual Creator verification gate (publish blocker)

- [ ] 6.1 Verify-phase runtime checks (design open question b): (a) `Service[Date_field1 >= s && Date_field1 <= e]` executes with Date variables in editor; (b) `List.add(index, entry)` accepted (else shift-copy fallback active); (c) Sender ID surfaces as Number; (d) seed 250 services → `truncated: true`, ≤200 processed; (e) Spanish reply renders correctly; (f) end-to-end widget turn "lista los 10 clientes más frecuentes en el servicio Locker" → ranked reply with breakdown; (g) prompt vago sin tipo → clarify (nunca genérico sin `serviceType`). AC: all spec scenarios pass. Smoke: full manual pass. ⏳ (pendiente — gate manual en Zoho Creator; no ejecutable localmente)
