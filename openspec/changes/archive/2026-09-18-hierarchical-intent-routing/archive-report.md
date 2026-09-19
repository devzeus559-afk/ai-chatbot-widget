# Archive Report: Hierarchical Intent Routing

**Change**: hierarchical-intent-routing
**Archived**: 2026-09-18
**Archived to**: `openspec/changes/archive/2026-09-18-hierarchical-intent-routing/`
**Artifact store**: openspec (repo-local, declared by native `gentle-ai sdd-status/v2`); hybrid persistence applied (archive report mirrored to Engram)

## Final State at Close

### Tasks

Persisted `tasks.md` (highest authority for observed completion) shows **28 task lines, all checked `[x]`, 0 pending** (Phases 1–6: taxonomy/paramSchema, resolve_period, prompt builders/normalizers/resolvers/facade, unit tests, docs, manual Creator gates 6.1–6.4). Native status agrees: `taskProgress total=28, completed=28, allComplete=true`, `applyState: all_done`.

- Count discrepancy noted (non-blocking): the launch prompt and `verify-report.md` header each state "22 tasks", but the persisted `tasks.md` contains 28 checkbox lines and native status reports 28. Every source agrees all tasks are complete, so no completion ambiguity exists; the count difference is recorded, not resolved.
- Gates recorded in `tasks.md`: 6.1 smoke 22/22 asserts (Creator, 2026-09-11), 6.2 regression 21/21 + `run_unit_normalize_category` 27/27 (Creator, 2026-09-18), 6.3 `chat_invoke` diff = 0 lines (static), 6.4 latency 8–15 s (Creator, 2026-09-18).

### Verification

Per `verify-report.md` (persisted 2026-09-18, committed in fcc144e, evidence_revision `sha256:a62a08c70a4e1bfe98195529c833d7ef66e8dbf5dddebe910819e257ee93bcfe`):

- Verdict: **pass** — `blockers: 0`, `critical_findings: 0`, `requirements: 11/11`, `scenarios: 26/26`.
- Gate 6.1 smoke: PASSED 22/22 asserts, 0 clarify loops (Creator 2026-09-11 21:39).
- Gate 6.2 regression: PASSED 21/21 live (run_live_first_turn 15 + run_live_multiturn 6), 0 failures incl. LIVE-07 greeting → kind=answer and LIVE-15 bitcoin → "transferencia"; `run_unit_normalize_category` 27/27 (Creator 2026-09-18).
- Gate 6.3: `git diff deluge/core/chat_invoke.deluge` = 0 lines (verified statically).
- Gate 6.4 latency: 8–15 s on representative prompts, avg < 30 s / worst < 40 s AC met (Creator 2026-09-18).

### Late fixes after intermediate snapshots (final-state authority)

- LIVE-07/LIVE-15 root cause and final fix: Deluge coerces `return null` from **string-typed** functions to `""`, so `"" != null` broke `if(fallback != null)` guards. Fixed in commit **c4c3634** (`fix(deluge): guard string-typed fallbacks against null-to-empty coercion`) — guards now use `length() > 0` on `category_history_fallback` / `keyword_search_tool` call sites; tests updated to accept null-or-empty. This fix landed AFTER the apply phase and is the terminal state at close; no stale "pending" claim survives from any earlier snapshot.

## Specs Synced into Main Specs (`openspec/specs/`)

| Domain | Action | Details |
|--------|--------|---------|
| chat-conversation-flows | Updated (native composition) | `gentle-ai sdd-archive-compose` (zero exit): 2 ADDED requirements (Hierarchical Intent Routing Pipeline, Pipeline Latency Budget), 2 MODIFIED requirements (Zero-API Chat Turn, Unknown Tool Fallback); 8 unrelated requirements preserved byte-identical (verified via `git diff`) |
| hierarchical-intent-routing | Created (new domain) | Full spec (not a delta) with 7 requirements, 17 scenarios; created by mechanical `cp` + empty `diff -r` + `mv` (no model Read/Write); file mode 644 preserved |

Composition note: the native compose tool normalizes block seams by removing the blank separator line between the replaced/appended requirement block and the following block (verified as cosmetic in `git diff`; no content loss; main spec was not hand-edited, per the mechanical contract).

## Archive Contents (preserved byte-identical, verified by empty `diff -r` readback)

- proposal.md — present (incl. Rollback Plan §: single `git revert`, zero migration, `chat_invoke` untouched; preserved verbatim)
- specs/chat-conversation-flows/spec.md — present (delta)
- specs/hierarchical-intent-routing/spec.md — present (delta)
- design.md — present
- tasks.md — present, 28/28 complete, 0 unfinished
- verify-report.md — present, verdict pass
- archive-report.md — this report (additive; excluded from readback comparison)
- apply-progress: absent — locator reported `<unresolved>` by native status; not an error (intermediate snapshot optional)
- state.yaml / exploration.md / research.md: absent (optional artifacts; never created for this change)

Move: `git mv` of the whole tracked change folder (all 6 files tracked, no untracked contents); destination guard passed (no pre-existing archive dir); source absent after move; mandatory `diff -r` of pre-move recursive snapshot vs archived tree produced EMPTY output (exit 0) — byte identity confirmed; edit permissions preserved (all files 644, same modes as originals).

## Unresolved Findings at Close (carried from verify-report; none fixed after its persistence)

Per `verify-report.md` (attributed; these were open at verification time and no later fix was recorded):

- **W2 (accepted deviation)**: `resolve_period` implemented with 2 params `(string periodEnum, date endDate)` vs design's 1-param form — Deluge has no default args; mapping behavior spec-compliant; design.md §2/§5 not updated.
- **W3 (environment)**: `creatorapp-backup/Logistic_Management_II.ds` modified in worktree — user-owned Creator dump, excluded from all commits (AGENTS.md); status confirms it remains unstaged and untouched by this archive.
- **S2**: redundant nested `if(parsed.containKey("params"))` at normalize_params:371 (dead code).
- **S3**: three `if(...get("status") == "error")` facade branches unreachable (defensive style).
- **S5**: task 4.4 text says "3 ambiguous" phrases; implemented suite/proposal have 9 tool-routing + 1 out-of-scope, 0 ambiguous — the within-category ambiguous member case remains untested.
- **S6**: task 3.4 / design signature `resolve_tool(map, string, map)` vs implementation `(map, string)` (fetches config internally; functionally equivalent).
- **S7**: `ultimos_30_dias` alias (spec: "último mes" ≡ "últimos 30 días") handled at chat_common.deluge:844 but not covered by `run_unit_resolve_period`.
- **S8**: paramSchema/task drift — `report_pounds_shipped`/`report_daily_average` carry inert optional params (`measure`/`country`) their tools never read; task 1.4 claims period enums for 4 tools the design and tools do not support (implementation correctly follows design+tools).

No critical findings or blockers at close. Rollback plan preserved in the archived proposal. No RDD/review mode was offered or launched; delivery follows ordinary repository policy (orchestrator handles commits).

## Engram Traceability (hybrid persistence)

Observations read for this archive: #253 `sdd/hierarchical-intent-routing/proposal`, #254 `sdd/hierarchical-intent-routing/spec`, #255 `sdd/hierarchical-intent-routing/design`, #256 `sdd/hierarchical-intent-routing/tasks` (all architecture, project ai-chatbot-widget). No Engram observation exists for verify-report (it lives only as the openspec file). Archive report persisted to Engram at topic key `sdd/hierarchical-intent-routing/archive-report`.