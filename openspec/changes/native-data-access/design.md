# Design: Native Creator Data Access

## Technical Approach

Replace all 16 `zoho.creator.*` calls (chat_invoke 8, chat_list 1, tools 5, on_submit 2) with native Creator access: `Form[criteria]` fetches (criteria string from `append_criteria`; blank → `[ID != 0]`), `insert into Form[...]` (returns numeric ID), and in-memory mutation of fetched records (auto-persists) — 0 external + 0 Developer API. Per specs `data-access-layer`, `chat-conversation-flows`, `lookup-tools`. Constraints respected: Zia 40s timeout, polling 45s, getRecords 200 max, no global Deluge state.

## Architecture Decisions

### Decision: Per-form typed helpers (not generic `fetch_records(form, criteria, sort, range)`)

| Option | Tradeoff | Decision |
|---|---|---|
| Generic helper with form/sort params | Native syntax requires **literal** form link names, sort fields, direction; only criteria string/range are variable-able → non-executable | Rejected |
| Per-form helpers | More functions, 1–3 lines each, guaranteed valid, centralize syntax + empty-criteria rule | Chosen — literal form/sort/range baked in; only criteria (+optional range) parameterized |

### Decision: `append_criteria` stays in `chat_common.deluge`

Tools already call it there — zero call-site churn. Only quoting changes: `"Field" == 'value'` → `Field == 'value'`; join stays ` and ` (proven live). Single shared builder for all 5 tools (spec).

### Decision: Mutable-record contract (session + request)

`get_or_create_session` returns a **bound record** both paths: existing → `ChatSessions[Session_ID == '...'].get(0)`; new → `insert into` returns only a numeric ID, so refetch `ChatSessions[ID == newId].get(0)`. `update_session(Map session, String firstPrompt)` receives that object and mutates `.Title` / `.Last_Activity` directly — fetched records persist mutation. Request answered by mutating the fetched record; `on_submit_chatrequests` mutates `input` on failure.

### Decision: Error contract

`.size() == 0` drives existing not-found maps (chat_invoke `Solicitud no encontrada`; track_package `No se encontró un paquete...`); list tools: no matches → `{"ok":true,"data":[]}` (parity; ok:false only for missing required params).

### Decision: Remove `appName` from chat_config

Consumed only by the removed calls → remove key + README mention; keep link names and `*Fields` maps.

### Decision: History is newest-first

`ChatMessages[Session == id] sort by Created_Time desc range from 0 to 9` → newest 10, no reverse; intentional carve-out (spec), passed to `chat_intent` in that order.

## Data Flow

```
On Submit -> chat_invoke(requestId)
  request = fetch_chat_requests("ID == " + id).get(0)     (bound)
  session = get_or_create_session(sessionId)              (bound; insert+refetch if new)
  user msg insert -> history(10) -> chat_intent -> dispatch_tool -> tool_* -> {ok,data}
  ai msg insert -> update_session(session, prompt)
  request.Status = "answered"; request.Reply = reply      (mutates bound record)
```

## File Changes

| File | Action | Description |
|---|---|---|
| `deluge/core/data_access.deluge` | Create | Per-form native fetch/insert helpers + `normalize_criteria` |
| `deluge/core/chat_common.deluge` | Modify | `append_criteria` native quoting |
| `deluge/core/chat_invoke.deluge` | Modify | 8 → 0: request/session/messages/history native + record mutation |
| `deluge/core/chat_list.deluge` | Modify | 1 → 0: `ChatSessions[User == userId] sort by Last_Activity desc range from 0 to 49` |
| `deluge/tools/tool_*.deluge` (5) | Modify | 5 → 0: native fetch via data_access; limits/sorts preserved |
| `deluge/workflow/on_submit_chatrequests.deluge` | Modify | 2 → 0: mutate `input.Status`/`input.Error` |
| `deluge/config/chat_config.deluge` | Modify | Remove dead `appName` |
| `deluge/README.md` | Modify | Diagram, function table (+data_access), appName removal |

## Interfaces / Contracts

`data_access.deluge` (each function starts `config = chat_config();` per config.yaml). Signatures:

```
normalize_criteria(c)             "" -> "ID != 0"
fetch_chat_requests(c)            ChatRequests[c]
fetch_chat_sessions(c, from, to)  ChatSessions[c] sort by Last_Activity desc [range]
fetch_chat_messages(c)            ChatMessages[c] sort by Created_Time desc range 0..9
insert_chat_session(d)            insert into ChatSessions -> new ID
insert_chat_message(d)            insert into ChatMessages -> new ID
fetch_packages(c)                 Package[c] sort by Created_Time desc
fetch_services(c) / fetch_offices(c) / fetch_coverage(c)   sort asc, range 0..199
fetch_contacts(c)                 sort asc, range 0..49
```

Contract notes: native clauses carry no quotes around field names; insert returns numeric ID → new-session path refetches for a bound record; tool return maps and `chat_invoke` status contract unchanged.

## Testing Strategy

No local runner — per-file Creator smoke checks before publish:

| Layer | What to Test | Approach (Creator) |
|---|---|---|
| data_access | Counts/order per helper | Run each: criteria fetch, blank criteria, insert -> ID |
| chat flows | Full turn end-to-end | Send via widget: session create/reuse, messages persist, `Status=answered` |
| chat_list + tools | User scoping; limits/sorts/not-found | 2 users; each tool with/without params; count <= limit, sort, messages |
| on_submit + regression | Failure path; history order | Force failure -> `input.Status="failed"`; >10 messages -> newest 10 |

## Migration / Rollout

No data migration. Publish order: `data_access` -> `chat_common` -> tools -> `chat_invoke`/`chat_list`/`on_submit`; smoke test each before publish. Rollback: git revert per-file commit + re-publish prior code.

## Open Questions

- [ ] Spec generic-signature vs Creator literal-syntax constraint (per-form chosen; revisit if form-name vars supported).
- [ ] Confirm `ChatRequests[ID == requestId]` resolves in-workflow on Submit.
- [ ] Confirm `User == <userId>` matches like today.
- [ ] Confirm bound-record mutation persists via `update_session` arg.
