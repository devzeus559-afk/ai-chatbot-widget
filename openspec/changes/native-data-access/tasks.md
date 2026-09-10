# Tasks: Native Creator Data Access

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~650–750 (10 files: data_access rewrite ~350, 5 tools ~175, chat flows ~80, chat_common ~15, chat_config ~10, READMEs ~80) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (data_access) → PR 2 (5 tools) → PR 3 (chat flows + Zia + cleanup + docs) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | `data_access.deluge` typed-helper rewrite (25 fns, remove `normalize_criteria`) | PR 1 | Base = develop/feature branch; ~350 lines; per-file commit for rollback |
| 2 | 5 tools → ID-list orchestration (addAll/intersect/empty guard) | PR 2 | Base = PR 1 branch (feature-branch-chain); ~175 lines; ends with 0 `append_criteria` callers |
| 3 | chat_invoke + chat_list + Zia no-comma (chat_intent, compose_with_ai) + chat_common cleanup + chat_config + READMEs | PR 3 | Base = PR 2 branch; ~185 lines; docs travel with code |

## Phase 1: Foundation (data_access re-architecture)

- [x] 1.1 Rewrite `deluge/core/data_access.deluge` — remove `normalize_criteria` + all criteria-string helpers; add 25 typed helpers per design Interfaces: `fetch_chat_requests_by_id`, `fetch_chat_sessions_by_session_id` / `_by_id` / `_by_user`, `insert_chat_session`, `fetch_chat_messages_by_session`, `insert_chat_message`, `fetch_packages_by_tracking`, per-condition `*_ids_by_*` (services×2 type/destination — origin no existe; offices×0 y coverage×0 — sin fetch por condición, filtro en memoria en las tools; vendors×2 type/name; contacts×3 full_name/phone/document — full_name filtra en memoria sobre subcampos de First_Name), `_by_ids` + `_all` per business form; literal form/sort/range baked, values only parameterized; every fn starts `config = chat_config();`. AC: `grep normalize_criteria deluge/` → 0; no criteria-string param; 0 `zoho.creator.*`. Smoke (Creator): run each helper — `[ID != 0]` fetch-all, per-condition `.ID.getAll()`, `[ID in ids]` sort/range, insert returns numeric ID.

## Phase 2: Tools migration (5 files → ID-list orchestration)

- [x] 2.1 `deluge/tools/tool_track_package.deluge` — `fetch_packages_by_tracking(trackingNumber).get(0)` (inline single equality; `Tracking_Number` literal, value variable). AC: no criteria string; ok:false messages preserved (missing param; `.size() == 0` not-found). Smoke: found + not-found numbers.
- [x] 2.2 `deluge/tools/tool_services.deluge` — branch: no filter → `fetch_services_all()`; else seed `targetIDs.addAll(fetch_services_ids_by_type(...))`, intersect with destination list (`Service.City`, real — no hay origin), guard `targetIDs.size() == 0 → List()`, final `fetch_services_by_ids(targetIDs)`. AC: 0/1/2 params; ≤200 sorted by `Service_ID`; empty intersection → `data:[]`. Smoke: param combos.
- [x] 2.3 `deluge/tools/tool_offices.deluge` — SIN fetch por condición: Commercial_Office no tiene City/Country top-level (son subfields del compuesto `Address`), así que la tool hace `fetch_offices_all()` + filtro EN MEMORIA sobre Address.district_city/country (case-insensitive). AC: ≤200 sorted by `Office_Name`; no filter → all. Smoke: pendiente gate 5.1 (Creator); verificación estática completa.
- [x] 2.4 `deluge/tools/tool_coverage.deluge` — REDESIGNADO por gate de esquema real: Coverage_Location NO tiene campos top-level country/vendor/service_type, así que NO hay fetch_*_ids por condición sobre ellos. La tool ahora (a) filtra `country` en memoria sobre `Address_Information1.country` y (b) conecta `serviceType`/`vendor` al módulo `Vendor` (Vendor_Type ↔ Service.Service_Type) vía `fetch_vendors_ids_*`, combinando ubicaciones + proveedores (ID-list + empty guard). AC: 0/1/2/3 params; vendors intersección vacía → `vendors:[]`; data siempre incluye locations. Smoke: pendiente gate 5.1 (Creator; combos country/serviceType/vendor); verificación estática completa.
- [x] 2.5 `deluge/tools/tool_contacts.deluge` — name: filtro en MEMORIA sobre subcampos de First_Name (first_name/last_name, case-insensitive; el composite no se compara a string plano) vía `fetch_contacts_ids_by_full_name`; phone/document: `.ID.getAll()`. Patrón addAll/intersect, `fetch_contacts_all()` / `_by_ids` (range 0–49). AC: ≤50 sorted by `First_Name`; empty intersection → `data:[]`. Smoke: pendiente gate 5.1 (Creator; filtros name/phone/document); verificación estática completa.

## Phase 3: Chat flows + Zia syntax (5 files)

- [x] 3.1 `deluge/core/chat_invoke.deluge` — typed helpers: `fetch_chat_requests_by_id(requestId).get(0)` (not-found → `Solicitud no encontrada`); `get_or_create_session` via `fetch_chat_sessions_by_session_id` → insert + refetch `fetch_chat_sessions_by_id(newId).get(0)` (keep null guard); `get_recent_history` via `fetch_chat_messages_by_session` (desc range 0–9, NO reverse); `update_session` + request mutation on bound records. AC: 0 `zoho.creator.*`; session/request mutable contract unchanged. Smoke: full widget turn (create + reuse); 25-message session → newest 10.
- [x] 3.2 `deluge/core/chat_list.deluge` — `fetch_chat_sessions_by_user(userId, 0, 49)`; user-scoped, `Last_Activity desc`; no matches → `{"ok":true,"data":[]}`. AC: only logged-in user's sessions. Smoke: 2 users → each sees own only.
- [x] 3.3 `deluge/core/chat_intent.deluge` — rewrite Zia call to no-comma syntax: each named param (`message`, `context`, `parameters`) on its own line inside `Zia[...]`, `files` omitted. AC: no commas between named params. Smoke: Creator editor accepts; tool/answer/clarify contract intact.
- [x] 3.4 `deluge/core/chat_invoke.deluge` `compose_with_ai` — same Zia no-comma rewrite (message/context/parameters). AC: no commas; fallback to `compose_reply` unchanged. Smoke: editor accepts; composeWithAI=true path.
- [x] 3.5 `deluge/workflow/on_submit_chatrequests.deluge` — no code change (already mutates `input.Status`/`input.Error` in memory, 0 calls; unaffected by redesign); verify only in gate 5.1. AC: failure path persists.

## Phase 4: Cleanup / Docs

- [x] 4.1 `deluge/core/chat_common.deluge` — delete `append_criteria` (0 callers after Phase 2) + update header comment; keep `parse_json_strict`/`compose_reply`/formatters. AC: `grep append_criteria deluge/` → 0. Smoke: static grep.
- [x] 4.2 `deluge/config/chat_config.deluge` — `*Fields` maps READ-ONLY for response mapping (valid `Map.get`); update comments: query field names are now literals in data_access; no `appName`. AC: `grep appName deluge/` → 0 code refs. Smoke: static.
- [x] 4.3 `deluge/README.md` — update diagram + function table (25 helpers: `*_ids_by_*`, `_by_ids`, `_all`); remove criteria-builder mentions; note `*Fields` read-only + Zia no-comma syntax. AC: docs match design Interfaces. Smoke: static review.
- [x] 4.4 `README.md` (root) — refresh function/criteria references to the ID-list pattern. AC: no stale criteria-string mentions. Smoke: static review.

## Phase 5: Manual Creator UI Verification Gate (publish blocker)

- [x] 5.1 Creator UI gate before publish — `insert into` skips On Validate/On Success, so verify in Creator UI: widget end-to-end (request → answered), session list per user, each tool (0/1/2+ params + empty intersection), failure path, history order; re-verify the 4 native assumptions post-redesign: (a) `Form[ID != 0]` fetch-all per form, (b) `Form[ID in ids]` final fetch (guard short-circuits empty list), (c) `ChatRequests[ID == requestId]` String/numeric type match, (d) no-comma Zia calls accepted in the editor. AC: all spec scenarios pass; `grep -rn "zoho\.creator\." deluge/` → 0 (README legacy mentions allowed). Smoke: full manual pass. ✅ Verificado 2026-09-10: suite `tests_native_data_access.*` (vía runners) → (a) `run_fetch_all` 8 forms no-null, (b) `run_fetch_ids` count coincide + empty-guard `data:[]`, (c) `test_chat_requests_id_type_match` Number/String→toNumber, 5 tools 0/1/2+ params + empty intersection, history `Created_Time` desc; turno widget E2E en Creator → `Status=answered`, inserts reales ChatMessages (user+ai), Zia no-comma ejecutando (**d**), sesión reutilizada (`get_or_create_session`); session list por usuario (**B**) → solo sesiones propias; ChatRequest rota → `Status=failed` + mensaje (**C** failure path).

## Phase 6: Coverage — Vendor + Service connection

- [x] 6.0 coverage-vendor-connection: alinear check_coverage al módulo real Vendor (Vendor_Type ↔ Service.Service_Type) y a Coverage_Location (Address_Information1 composite); conectar geografía (country) + proveedores. Verificado estáticamente (0 helpers rotos, 0 lecturas de campos inexistentes).
