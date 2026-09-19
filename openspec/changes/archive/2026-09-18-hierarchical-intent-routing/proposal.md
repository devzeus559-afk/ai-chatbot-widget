# Proposal: Hierarchical Intent Routing

## Intent

With 15 tools in a flat catalog, Zia frequently misroutes or enters `clarify` loops on ambiguous queries (e.g. "clientes más frecuentes de paquetería" — Zia must distinguish 3 similar report tools). A single Zia call evaluating all 15 descriptions produces ~40% clarification bounces on queries that a human would route instantly. This change decomposes the monolithic Zia call into a 3-step hierarchical pipeline (category → tool → params), each with a tiny decision space.

## Scope

### In Scope

- Rewrite `chat_intent.deluge`: `chat_intent()` becomes a facade that chains 3 Zia calls with short-circuit on clarify/null.
- 3 new helper functions in `chat_intent.deluge`: `resolve_category(prompt, history)`, `resolve_tool(prompt, category, filteredCatalog)`, `resolve_params(prompt, toolName, schema)`.
- `chat_config.deluge`: add 5-category taxonomy map, `toolsByCategory` sublists, `toolsTextByCategory` prompt fragments, per-tool `paramSchema`.
- `chat_common.deluge`: add `resolve_period(periodEnum)` helper converting enum → date pair.
- Period enum: `ultimo_mes | mes_anterior | este_mes | ultimos_7_dias` — Zia returns the enum string, backend resolves dates.
- `tests_chat_intent.deluge`: add 10 live cases for hierarchical routing + `tests_intent_hierarchical` smoke suite.
- Category taxonomy (15 tools):
  - SEARCH (4): search_services, find_offices, check_coverage, find_contacts
  - TRACKING (1): track_package
  - TOP_CUSTOMERS (3): report_top_customers, report_top_package_customers, report_top_remittance_customers
  - PACKAGE_ANALYSIS (3): report_pounds_shipped, report_daily_average, report_monthly_comparison
  - OTHER_ANALYSIS (4): report_shipping_type_frequency, report_merchandise_type, report_delayed_packages, report_unscanned_packages

### Out of Scope

- `chat_invoke.deluge` — must NOT be touched (orchestrator is stable).
- Individual `tool_*.deluge` files — no changes to tool implementations.
- Widget changes — none; the `{tool,params}|{answer}|{clarify}` contract is unchanged.
- `composeWithAI` mode — unchanged.

## Approach

**3-Zia-call hierarchical pipeline** inside `chat_intent()`:

1. **Call 1 — resolve_category(prompt, history)**: Classify into one of 5 categories + SEARCH_ACK (greeting/generic) + OUT_OF_SCOPE. Prompt lists only category names + one-line descriptions. Returns `{"category": "<name>"}` or `{"clarify": "..."}` or `{"answer": "..."}`.

2. **Call 2 — resolve_tool(prompt, category, filteredCatalog)**: Receive the sub-catalog for the chosen category (max 4 tools). Each tool entry has name + short description + required params hint. Returns `{"tool": "<name>", "params": {...}}` or `{"clarify": "..."}`.

3. **Call 3 — resolve_params(prompt, toolName, paramSchema)**: Receive a single tool's schema (required/optional fields + enum constraints). For reports with date params: Zia returns `period: "ultimo_mes"` (enum), backend resolves via `chat_common.resolve_period()`. Returns `{"tool": "<name>", "params": {...}}`.

**Short-circuit**: If any call returns `clarify` or `answer`, return immediately — no further calls.

**Latency budget**: 3 × Zia ≈ 18–24s (6–8s each, temperature 0.1). Well under 40s Zia timeout and 45s widget polling.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `deluge/core/chat_intent.deluge` | Modified | Facade rewrite + 3 new helpers; `normalize_zia_response` reused as-is |
| `deluge/config/chat_config.deluge` | Modified | Category taxonomy, toolsByCategory, toolsTextByCategory, paramSchema map |
| `deluge/core/chat_common.deluge` | Modified | Add `resolve_period(periodEnum)` helper |
| `deluge/core/tests_chat_intent.deluge` | Modified | 10 new hierarchical routing cases |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| 3 Zia calls exceed 40s Zia timeout on slow responses | Low | Temperature 0.1 + short prompts (4–8 tools max per call) keep each under 8s; add `if(zia_response == null)` null guard per call |
| Zia returns inconsistent category names | Medium | Normalize to exact enum in `resolve_category` prompt; validate before passing to Call 2 |
| Increased Zia cost per query (3× vs 1×) | Accepted | Offset by fewer clarification bounces and faster resolution; `composeWithAI` already adds optional 2nd call |

## Rollback Plan

Single commit revert: `git revert <commit>` reverts `chat_config.deluge` (taxonomy removed) + `chat_intent.deluge` (restored to flat 1-call routing). Zero migration steps — the flat catalog entries in `chat_config` are preserved alongside the new maps, so the old `chat_intent()` signature `chat_intent(prompt, history)` is unchanged. `chat_invoke` is never touched, so it reconnects seamlessly to the old flat logic.

## Constraints

- 3 Zia calls ≈ 18–24s total, must stay under 40s Zia timeout and 45s widget polling.
- Temperature 0.1 for all 3 calls (deterministic routing).
- Deluge syntax: no commas between named params, no ternary operator, `if(c,a,b)` ternary-style only, `else if` blocks allowed, `config = chat_config()` at top of every function.
- No global state between functions; each helper starts with `config = chat_config()`.

## Verification

1. `tests_chat_intent.deluge` — 10 new `run_live_hierarchical()` cases: 5 category-routing cases (one per category), 3 ambiguous queries (today → clarify, new → correct tool), 2 out-of-scope cases.
2. Manual smoke in Creator: `tests_intent_hierarchical.run_smoke()` — 10 phrases that currently cause clarify loops:
   - "clientes más frecuentes de paquetería" → report_top_package_customers
   - "comparación mensual de libras" → report_monthly_comparison
   - "cajas sin escanear" → report_unscanned_packages
   - "dónde tienen oficina en Miami" → find_offices
   - "cobertura en Cuba" → check_coverage
   - "rastrear P-123456" → track_package
   - "frecuencia de envíos aéreos" → report_shipping_type_frequency
   - "libras enviadas en marzo" → report_pounds_shipped
   - "clientes con más remesas" → report_top_remittance_customers
   - "¿qué es Bitcoin?" → clarify (out of scope)

## Success Criteria

- [ ] All 10 hierarchical smoke tests pass in Creator (tool correctly resolved, no clarify loop)
- [ ] `chat_invoke.deluge` is NOT modified (git diff confirms 0 changes)
- [ ] 3-Zia latency stays under 30s on average (manual timer in Creator logs)
- [ ] Zero regressions: existing 16 live cases in `tests_chat_intent.run_live_first_turn()` + `run_live_multiturn()` still pass
- [ ] `normalize_zia_response` and `build_intent_prompt` tests pass unchanged