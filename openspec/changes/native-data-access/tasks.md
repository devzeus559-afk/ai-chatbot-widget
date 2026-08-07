# Tasks: Native Creator Data Access

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~220–280 (9 files: 1 new data_access ~90–110, 8 modified ~130–170) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR (per-file commits for targeted rollback) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Full migration (data_access → append_criteria → tools → chat flows → on_submit → docs) | PR 1 | Single PR to develop; ~250 lines; per-file commits enable per-file rollback |

## Phase 1: Foundation (data_access + criteria builder)

- [x] 1.1 Create `deluge/core/data_access.deluge` — per-form native helpers `fetch_chat_requests`, `fetch_chat_sessions(c, from, to)`, `fetch_chat_messages` (desc range 0–9), `insert_chat_session`, `insert_chat_message`, `fetch_packages`, `fetch_services`, `fetch_offices`, `fetch_coverage`, `fetch_contacts` + `normalize_criteria` ("" → "ID != 0"). Files: `deluge/core/data_access.deluge`. AC: every fn starts `config = chat_config();`, literal form/sort/range baked in, native syntax (no quoted field names), 0 `zoho.creator.*`. Smoke (Creator): run each helper — criteria fetch, blank criteria → `[ID != 0]`, insert returns numeric ID.
- [x] 1.2 Rewrite `append_criteria` in `deluge/core/chat_common.deluge` — emitted criteria uses native quoting (`Field == 'value'`), `'value'` and ` and ` join unchanged; existing tool call sites untouched. AC: no `"Field"` wrappers in output; one-clause and two-clause joins correct. Smoke (Creator): `append_criteria` with blank side → passthrough; two clauses → `A == 'x' and B == 'y'`.

## Phase 2: Tools migration (5 files, 7 calls → 0)

- [x] 2.1 `deluge/tools/tool_track_package.deluge` — `fetch_packages("Tracking_Number == '...'")` + `.get(0)` (newest, Created_Time desc); keep ok:false messages (missing param; `.size() == 0` not-found). AC: single map {trackingNumber, status, origin, destination, currentLocation, estimatedDelivery}. Smoke: found + not-found numbers.
- [x] 2.2 `deluge/tools/tool_services.deluge` — `fetch_services(criteria)`: range 0–199, `Service_Name` asc. AC: ≤200, sorted, blank criteria → all. Smoke: with/without filters.
- [x] 2.3 `deluge/tools/tool_offices.deluge` — `fetch_offices(criteria)`: range 0–199, `Office_Name` asc. AC: ≤200 sorted. Smoke: with/without filters.
- [x] 2.4 `deluge/tools/tool_coverage.deluge` — `fetch_coverage(criteria)`: range 0–199, `Country` asc. AC: combined clauses join via `append_criteria`. Smoke: country+vendor filters.
- [x] 2.5 `deluge/tools/tool_contacts.deluge` — `fetch_contacts(criteria)`: range 0–49, `Full_Name` asc. AC: ≤50. Smoke: name/phone/document filters.

## Phase 3: Chat flows (3 files, 11 calls → 0)

- [x] 3.1 `deluge/core/chat_invoke.deluge` — request via `fetch_chat_requests("ID == " + id).get(0)` (bound); `get_or_create_session`: existing `.get(0)` / new insert + refetch `ChatSessions[ID == newId].get(0)`; `create_message` via `insert_chat_message`; `get_recent_history` newest 10 (desc range 0–9, NO reverse — spec History Returns Newest 10); `update_session` mutates the passed bound record (Title≤50 + Last_Activity, or Last_Activity only); mark answered by mutating request record. AC: full turn 0 calls; not-found → `{"status":"failed","message":"Solicitud no encontrada"}`. Smoke: full widget turn (session create + reuse); 25-message session → newest 10 returned.
- [x] 3.2 `deluge/core/chat_list.deluge` — `fetch_chat_sessions("User == " + userId, 0, 49)`; user-scoped, `Last_Activity desc`; no matches → `{"ok":true,"data":[]}`. AC: only logged-in user's sessions. Smoke: 2 users → each sees own only.
- [x] 3.3 `deluge/workflow/on_submit_chatrequests.deluge` — replace both `zoho.creator.updateRecord` with in-memory `input.Status = "failed"` / `input.Error = ...` (spec Failure Status via Input Mutation). AC: 0 calls; failure path persists. Smoke: force chat_invoke failure → record shows failed/Error.

## Phase 4: Cleanup / Docs

- [x] 4.1 `deluge/config/chat_config.deluge` — remove `appName` key + its comment (only consumed by removed calls; keep link names + `*Fields` maps). AC: `grep appName deluge/` → no code refs. Smoke: static grep.
- [x] 4.2 `deluge/README.md` — update diagram + "Funciones a crear" table (+data_access), remove `appName` setup mention (line ~154). AC: docs match new architecture. Smoke: static review.

## Phase 5: Manual UI Verification Gate (publish blocker)

- [ ] 5.1 Creator UI gate before publish — `insert into` skips On Validate/On Success, so verify in Creator UI: widget end-to-end (request → answered), session list, each tool, failure path, history order. AC: all spec scenarios pass; `grep -rn "zoho\.creator\." deluge/` → 0 (README legacy mentions allowed). Smoke: full manual pass.
