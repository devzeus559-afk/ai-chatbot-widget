# Proposal: Native Creator Data Access (Eliminate zoho.creator.* API Calls)

## Intent
- Today: 16 `zoho.creator.*` tasks across the Deluge backend ≈ **8–9 external API calls per chat turn** (each `zoho.creator.*` task = 1 Developer API call + 1 external call).
- Native Creator data access (`fetch Form[criteria]`, `insert into`, in-memory `rec.Field = value`) consumes **0 external + 0 Developer API calls** (Custom Function: Yes).
- Goal: migrate all 16 calls to native access → 0 external calls/turn (Zia stays 0), cutting API cost + latency with identical behavior.

## Scope

### In Scope
- **New** central module `deluge/core/data_access.deluge` — native fetch/insert/mutate helpers + `append_criteria` rewritten to native syntax (no double quotes around field names).
- `deluge/core/chat_invoke.deluge` (7 calls): request lookup, session lookup, session/user-message insert, history fetch (`ChatMessages[Session == id] sort by Created_Time desc range from 0 to 9`), in-memory session + request updates.
- `deluge/core/chat_list.deluge` (1): `ChatSessions[User == zoho.loginuser.get("Id")] sort by Last_Activity desc`.
- 5 tools (7 calls): native criteria + limits (contacts 0–49, others 0–199, track_package 1, sort by name/country asc).
- `deluge/workflow/on_submit_chatrequests.deluge` (2): mutate `input` record (already in memory) → 0 calls.

### Out of Scope
- Widget `ZOHO.CREATOR.API.addRecord` (0 external per Billing docs).
- Zia `chat_intent` (0 external).
- 50/200 record limits — intentional; preserved via native `range from`.
- Schema changes, Node server, test runner.

## Capabilities
### New Capabilities
- `data-access-layer`: central native Creator access (fetch/insert/mutate, native criteria builder) shared by all flows.
- `chat-conversation-flows`: chat invoke/list session + message persistence via native access.
- `lookup-tools`: 5 business tools using native criteria (limits/sorts preserved).

### Modified Capabilities
- None (`openspec/specs/` is empty).

## Approach
1. Build `data_access.deluge`: `fetch_form(form, criteria, sort, range)`, `insert_record(form, map)`, native `append_criteria`.
2. Migrate per call: fetch returns COLLECTION → `.get(0)` single, `.size() == 0` not-found; empty criteria → `[ID != 0]`; `insert into` returns new record ID.
3. Session record from `get_or_create_session` passed as **mutable** record to `update_session` (no fresh Map).
4. Rewrite `append_criteria` once (shared by tools); field-name quoting change is the only breaking diff.

## Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| `deluge/core/data_access.deluge` | New | Central native access + criteria builder |
| `deluge/core/chat_invoke.deluge` | Modified | 7 calls → native |
| `deluge/core/chat_list.deluge` | Modified | 1 call → native |
| `deluge/tools/tool_{track_package,services,offices,coverage,contacts}.deluge` | Modified | 7 calls → native |
| `deluge/workflow/on_submit_chatrequests.deluge` | Modified | 2 calls → 0 (mutate `input`) |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| On Validate/On Success scripts exist (grep: no; `insert into` skips them) | Low | **Gate**: manual UI verification in Creator before publish |
| Native syntax errors (quotes, collection access, range) — no local runner | Med | Static review + Creator smoke test per migrated file |
| `append_criteria` rewrite breaks tools | Med | Single shared builder; verify all 5 tools in Creator |
| History behavior change (200→trim 10) | Low | Result set identical; native fetches 10 directly |

## Rollback Plan
- Git revert (all `.deluge` files tracked) + re-publish previous workflow code in Creator (On Submit → chat_invoke). Per-call commits allow targeted rollback.

## Dependencies
- All tables in same Creator app (verified).
- Manual UI verification in Zoho Creator before publish.

## Success Criteria
- [ ] 0 `zoho.creator.*` calls remain; 0 external calls per chat turn (Zia aside)
- [ ] Chat flows + 5 tools behave identically in Creator smoke tests
- [ ] History fetch returns newest 10 (was 200→trim)
- [ ] All limits/sorts preserved
