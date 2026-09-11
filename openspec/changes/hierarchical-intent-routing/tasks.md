# Tasks: Hierarchical Intent Routing

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~430–525 (4 files: chat_intent ~180, chat_config ~90, chat_common ~25, tests ~180; docs ~15) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | 2 PRs — PR 1: chat_config + chat_common + chat_intent (core); PR 2: tests |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | chat_config taxonomy + chat_common resolve_period + chat_intent hierarchical pipeline | PR 1 | Static review: grep `resolve_category`/`resolve_tool`/`resolve_params` in chat_intent; grep `taxonomy`/`toolsByCategory`/`toolsTextByCategory`/`paramSchema` in chat_config; grep `resolve_period` in chat_common | Creator manual: `chat_intent("rastrea ABC123", List())` → kind=tool + resolve_period unit cases | Single revert removes taxonomy maps, resolve_period, and restores flat chat_intent |
| 2 | Unit + live tests for hierarchical routing | PR 2 | Creator: `tests_chat_intent.run_unit_hierarchical()` + `tests_intent_hierarchical.run_smoke()` | Creator manual: 10 hierarchical phrases + regression first-turn/multiturn | Revert removes test functions only; core logic unchanged |

## Phase 1: chat_config — taxonomy + param schemas

- [x] 1.1 Add `taxonomy` Map: 5 entries mapping category name → List of tool names (SEARCH→4, TRACKING→1, TOP_CUSTOMERS→3, PACKAGE_ANALYSIS→3, OTHER_ANALYSIS→4). All 15 tools covered, no duplicates.
- [x] 1.2 Add `toolsByCategory` Map: reverse lookup tool name → category name (15 entries). Used by resolve_tool to validate Zia's choice against the filtered catalog.
- [x] 1.3 Add `toolsTextByCategory` Map: category name → formatted Zia prompt fragment (same pattern as existing `toolsText`). Builder loop iterates `tools` filtered by `toolsByCategory.get(t.name) == category`. Preserve existing `toolsText` for fallback/compatibility.
- [x] 1.4 Add `paramSchema` Map: tool name → schema text listing required params (bold/highlight) vs optional params, plus enum values for period-capable tools. Per tool: track_package (`trackingNumber` required), search_services (`destination`, `serviceType` optional), find_offices (`city`, `country`, `phone`, `document` optional), check_coverage (`country`, `city`, `vendor` optional), find_contacts (`name`, `phone`, `document` optional), report_top_customers/service/remittance (`serviceType` required List≥1, `limit` optional default 10), report_pounds_shipped/daily_average/monthly_comparison (`period` enum, `office`, `country`, `measure` optional), report_shipping_type_frequency/merchandise_type (`period` enum, `limit` optional), report_delayed_packages/unscanned_packages (`period` enum, `limit` optional). AC: `grep taxonomy chat_config` → 5 cats; `grep toolsTextByCategory chat_config` → 5 entries; static review.

## Phase 2: chat_common — resolve_period

- [x] 2.1 Add `list chat_common.resolve_period(string periodEnum)` — takes enum string, returns `[startDate, endDate]` list of 2 dates. Uses `zoho.currentdate` as today. AC: 5 enum cases match spec exactly.
- [x] 2.2 `ultimo_mes` / `ultimos_30_dias` → `[today.subDay(30), today]`; `mes_anterior` → `[first_of_month(today.addMonth(-1)), first_of_month(today).subDay(1)]`; `este_mes` → `[first_of_month(today), today]`; `ultimos_7_dias` → `[today.subDay(7), today]`; default (unrecognized) → `[today.subDay(30), today]`. AC: Creator manual — call each case on known date, verify output.

## Phase 3: chat_intent — prompt builders + normalizers + resolvers + facade

- [x] 3.1 Add `string chat_intent.build_category_prompt(string userPrompt, list history)` — returns prompt with 5 category names + one-line descriptions + answer/clarify/out-of-scope rules + history section + userPrompt. Contract from design Prompt 1. AC: static review — prompt contains SEARCH/TRACKING/TOP_CUSTOMERS/PACKAGE_ANALYSIS/OTHER_ANALYSIS.
- [x] 3.2 Add `map chat_intent.normalize_category(map ziaResponse)` — validates JSON has key `category`, `answer`, or `clarify`. `category` must be exact enum value (one of 5). Returns `{"category":"..."}` or `{"answer":"..."}` or `{"clarify":"..."}`. AC: static — normalize handles category/answer/clarify/null/error cases.
- [x] 3.3 Add `string chat_intent.build_tool_prompt(string userPrompt, string category, string filteredCatalog)` — prompt with single category name + filtered tool list (1–4 tools) + rule: pick one tool even if required param missing. Contract from design Prompt 2. AC: static — prompt contains only tools from the given category.
- [x] 3.4 Add `map chat_intent.normalize_tool(map ziaResponse, string category, map toolsByCategory)` — validates JSON has key `tool`, tool name is in `toolsByCategory` for the given category. Returns `{"tool":"...", "params":{}}` or `{"clarify":"..."}`. AC: static — unknown tool for category returns clarify.
- [x] 3.5 Add `string chat_intent.build_params_prompt(string userPrompt, string toolName, string paramSchema)` — prompt with single tool name + its param schema + enum values for period. Contract from design Prompt 3. AC: static — prompt contains tool name and schema text.
- [x] 3.6 Add `map chat_intent.normalize_params(map ziaResponse, string toolName)` — validates JSON has key `params` or `clarify`. If `params` present, omit absent optionals (no null/empty). If `period` key present, call `chat_common.resolve_period()` and set `startDate`/`endDate`. Returns `{"tool":"...", "params":{...}}` or `{"clarify":"..."}`. AC: static — period→dates conversion; absent optionals omitted.
- [x] 3.7 Add `map chat_intent.resolve_category(string userPrompt, list history)` — builds prompt via `build_category_prompt`, calls Zia with temperature 0.1, null-guard returns generic clarify, normalizes via `normalize_category`. AC: static — null guard + normalize delegation.
- [x] 3.8 Add `map chat_intent.resolve_tool(string userPrompt, string category, string filteredCatalog)` — builds prompt via `build_tool_prompt`, calls Zia with temperature 0.1, null-guard, normalizes via `normalize_tool` with category validation. AC: static.
- [x] 3.9 Add `map chat_intent.resolve_params(string userPrompt, string toolName, string paramSchema)` — builds prompt via `build_params_prompt`, calls Zia with temperature 0.1, null-guard, normalizes via `normalize_params`. AC: static.
- [x] 3.10 Rewrite `chat_intent.chat_intent(string userPrompt, list history)` as facade: (1) `resolve_category(prompt, history)`; (2) if category → `resolve_tool(prompt, category, config.toolsTextByCategory.get(category))`; (3) if tool → `resolve_params(prompt, tool, config.paramSchema.get(tool))`; (4) assemble `{"kind":"tool","tool":"...","params":{...}}`. Short-circuit: answer/clarify/null at any stage → return immediately. `build_intent_prompt` kept for backward compat with existing tests. AC: static — `chat_invoke` grep = 0 changes; signature unchanged; external contract same.
- [x] 3.11 Extend `normalize_zia_response` to recognize `"category"` as valid key (1 addition alongside existing tool/answer/clarify). AC: static — existing normalize tests still pass.

## Phase 4: tests — hierarchical routing

- [x] 4.1 Unit tests: `test_normalize_category` (5 category enum values + answer + clarify + null) in `tests_chat_intent.deluge`. AC: Creator `run_unit()` — all existing + new category tests pass.
- [x] 4.2 Unit tests: `test_resolve_period` (4 enums: ultimo_mes, mes_anterior, este_mes, ultimos_7_dias + default) calling `chat_common.resolve_period` directly. AC: Creator — correct date pairs on known date.
- [x] 4.3 Unit tests: `test_normalize_tool` (valid tool in category + tool outside category → clarify) + `test_normalize_params` (required absent → clarify; optional absent → omitted; period → dates). AC: Creator — all unit tests pass.
- [x] 4.3b CORRECCIÓN (apply PR2 gatekeeper): enforcement determinista de requireds en `normalize_params` — `track_package.trackingNumber` vacío/ausente → clarify; `report_top_customers.serviceType` no-lista o vacía → clarify (Zia ignorando el contrato con `{"params":{}}` ya no pasa). AC: static — unit tests 4.3 ampliados (params vacío, serviceType string, List válida); balance OK.
- [x] 4.4 `run_live_hierarchical()`: 10 phrases from proposal — 5 category-routing (one per cat), 3 ambiguous, 2 out-of-scope. Uses `chat_intent(prompt, List())`. Assert kind/tool per case. AC: 10/10 resolved in 1 iteration, no clarify loops.
- [x] 4.5 `tests_intent_hierarchical.run_smoke()`: manual Creator suite with the 10 phrases + latency measurement. Reports pass/fail + time per phrase. AC: all 10 pass, average latency < 30s.

## Phase 5: Docs

- [x] 5.1 Add 1-paragraph footnote to `deluge/README.md` and/or `AGENTS.md` describing hierarchical intent routing (category→tool→params, 5 categories, short-circuit, 3 Zia calls). AC: static review.

## Phase 6: Manual Creator verification gate (publish blocker)

- [ ] 6.1 Run `tests_intent_hierarchical.run_smoke()` — all 10 hierarchical phrases resolve correctly in ≤1 Zia iteration per phrase. AC: 10/10 pass, no clarify loops.
- [ ] 6.2 Run regression: `tests_chat_intent.run_live_first_turn()` (15 cases) + `tests_chat_intent.run_live_multiturn()` (6 cases) — all existing tests pass unchanged. AC: 21/21 pass.
- [ ] 6.3 Verify `git diff deluge/core/chat_invoke.deluge` = 0 lines changed. AC: orchestrator untouched.
- [ ] 6.4 Measure 3-Zia-call latency on 5 representative prompts — average must be < 30s, worst-case < 40s. AC: manual timer in Creator logs.
