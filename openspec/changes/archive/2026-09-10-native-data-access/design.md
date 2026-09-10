# Design: Native Creator Data Access

## Technical Approach

Replace all 16 `zoho.creator.*` calls (chat_invoke 8, chat_list 1, tools 5, on_submit 2) with native Creator access: `Form[Field == valueVar]` fetches with LITERAL field names and variable values, `insert into Form[...]` (returns numeric ID), and in-memory mutation of bound records — 0 external + 0 Developer API calls (Zia aside).

**CHANGED (gate 5.1)**: a criteria-string variable inside the brackets (`Form[criteriaVar]`) is INVALID in Creator, and field names cannot come from variables (e.g. `fields.get("country")` inside brackets) — they MUST be form literals. Filtering therefore uses explicit (literal field, value variable) pairs, with three branches per fetch site:

- **0 conditions** → `Form[ID != 0]` (explicit user decision — NOT `ID != null`)
- **exactly 1 condition** → inline single-equality fetch `Form[Field == valueVar] sort by ... range ...` (valid: only the value is a variable) — used by `track_package` and all chat flows (fixed, non-combinable conditions)
- **2+ conditions (AND)** → ID-list pattern: per-condition `Form[Field == value].ID.getAll()`, seed `targetIDs` via `addAll`, `intersect` subsequent lists, final `Form[ID in targetIDs] sort by ... range ...`

`normalize_criteria` (data_access) and `append_criteria` (chat_common) are **REMOVED** — no string criteria building anywhere. Per specs `data-access-layer`, `lookup-tools`, `chat-conversation-flows` (source of truth). Constraints respected: Zia 40s timeout, polling 45s, getRecords 200 max, no global Deluge state.

## Architecture Decisions

### Decision: Criteria-string builders removed (`normalize_criteria`, `append_criteria`)

| Option | Tradeoff | Decision |
|---|---|---|
| Keep builders, emit `Form[criteriaVar]` | `Form[criteriaVar]` invalid in Creator → nothing executes | Rejected |
| Remove both from the surface (spec already did); tools call typed per-condition helpers | No shared builder; each tool branches on active params | Chosen |

### Decision: Literal field names live ONLY in data_access helpers

| Option | Tradeoff | Decision |
|---|---|---|
| Build `Field == 'value'` strings in tools from `*Fields` config maps | Field name from a variable inside brackets is invalid | Rejected |
| Bake literal field names into per-form/per-condition helpers | Field names appear once per query; `*Fields` maps stay READ-ONLY for response attribute reads (`pkg.get(fields.get("trackingNumber"))` — plain Map.get, valid) | Chosen |

### Decision: ID-list combination lives in the TOOLS (orchestration); data_access owns query shapes

| Option | Tradeoff | Decision |
|---|---|---|
| Generic criteria/ID helper parameterized by form/field | Native syntax requires literals for form/sort/range → non-executable | Rejected |
| data_access: per-condition ID helpers (`Form[Field == value].ID.getAll()`) + final `Form[ID in targetIDs]` fetch (sort/range baked); tools seed `addAll`, `intersect`, branch any-vs-none | data_access stays declarative/syntax-safe; tools know how many conditions are active at runtime (Zia params) and compose with native List ops (`addAll`/`intersect` are built-ins — no custom helper needed) | Chosen |

### Decision: Uniform ID pipeline for any active condition in list tools

| Option | Tradeoff | Decision |
|---|---|---|
| 1 condition → inline full fetch; 2+ → ID-list | Two query paths per tool; contradicts spec scenario "Single-condition ID path" | Rejected |
| Any active condition → per-condition IDs + final `[ID in targetIDs]`; 0 → `[ID != 0]` | One uniform path; the per-condition query IS the validated inline single-equality form; matches `data-access-layer` scenario | Chosen |

### Decision: `Form[ID != 0]` for no filters

Explicit user decision — NOT `ID != null` — as the fetch-all guard in every form. Runtime confirmation per form is an open question (see Open Questions b).

### Decision: Mutable-record contract preserved (unchanged)

`get_or_create_session` returns a BOUND record both paths: existing → `fetch_chat_sessions_by_session_id(...).get(0)`; new → `insert into` returns numeric ID → refetch `fetch_chat_sessions_by_id(newId).get(0)`. `update_session(Map session, ...)` and request-answered mutation (`request.Status = "answered"`) mutate the fetched record — persists with no API call. Keep the null/empty guard on the post-insert refetch.

### Decision: History newest-first (unchanged)

`ChatMessages[Session == sessionId] sort by Created_Time desc range from 0 to 9` — single-equality inline, no reverse; intentional carve-out (spec), passed to `chat_intent` in that order.

### Decision: Zia task invocation — no commas between parameters (RESOLVED)

Official syntax (Zoho Deluge docs, Zia task): parameters are NOT comma-separated; each named parameter goes on its own line inside `Zia[...]`:

```
response = Zia[
    message : "message_prompt"
    files : <file_name>        // optional
    context : "context"        // optional
    parameters : <param_type>  // optional
];
```

Applies to the existing `Zia[message: ..., context: ..., parameters: {...}]` calls in `chat_intent` and `compose_with_ai` — they currently use commas (invalid in the Creator editor). Corrected form:

```deluge
response = Zia[
    message : message
    context : context
    parameters : {"temperature": 0.0}
];
```

Note: parameter order follows the docs (message, files, context, parameters); `files` omitted when unused.

## Data Flow

```
On Submit -> chat_invoke(requestId)
  request = fetch_chat_requests_by_id(requestId).get(0)      (bound)
  session = get_or_create_session(sessionId)                 (bound; insert+refetch if new)
    existing: fetch_chat_sessions_by_session_id(sessionId).get(0)
    new:      insert_chat_session(data) -> fetch_chat_sessions_by_id(newId).get(0)
  insert_chat_message(user) -> history(10, newest-first) -> chat_intent -> dispatch_tool
    tool_* list:   0 filters -> fetch_<form>_all()              [ID != 0]
                   1+ filters -> per-condition IDs + addAll/intersect -> fetch_<form>_by_ids(targetIDs)
    track_package: fetch_packages_by_tracking(t).get(0)         (inline single equality)
  insert_chat_message(ai) -> update_session(session, prompt)    (mutate bound record)
  request.Status = "answered"; request.Reply = reply            (mutate bound record)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `deluge/core/data_access.deluge` | Modify | Replace criteria-string helpers with per-condition ID helpers + `_by_ids` + `_all` + typed chat helpers; remove `normalize_criteria` |
| `deluge/core/chat_common.deluge` | Modify | Remove `append_criteria` (no callers remain); keep formatters/parse/compose |
| `deluge/core/chat_invoke.deluge` | Modify | 8 → 0: typed fetch helpers + record mutation (contract unchanged) |
| `deluge/core/chat_list.deluge` | Modify | 1 → 0: `fetch_chat_sessions_by_user(userId, 0, 49)` |
| `deluge/tools/tool_*.deluge` (5) | Modify | 5 → 0: ID-list orchestration per tool; limits/sorts preserved; `*Fields` maps read-only for response mapping |
| `deluge/workflow/on_submit_chatrequests.deluge` | Modify | 2 → 0: mutate `input.Status`/`input.Error` (unchanged) |
| `deluge/config/chat_config.deluge` | Modify | Remove dead `appName`; `*Fields` maps stay (read-only response mapping) |
| `deluge/README.md` | Modify | Diagram, function table (+data_access), appName removal |

## Interfaces / Contracts

`data_access.deluge` (each fn starts `config = chat_config();` per config.yaml). Literal form link names, sort fields and ranges are baked in; only VALUES are parameters. No criteria-string parameter anywhere:

```
# ChatRequests
List fetch_chat_requests_by_id(Number requestId)          # ChatRequests[ID == requestId]

# ChatSessions
List fetch_chat_sessions_by_session_id(String sessionId)  # ChatSessions[Session_ID == sessionId]
List fetch_chat_sessions_by_id(Number id)                 # ChatSessions[ID == id]  (post-insert refetch)
List fetch_chat_sessions_by_user(Number userId, Number from, Number to)   # ChatSessions[User == userId] sort by Last_Activity desc [range]
Number insert_chat_session(Map data)                      # insert into ChatSessions -> new ID

# ChatMessages
List fetch_chat_messages_by_session(Number sessionId)     # ChatMessages[Session == sessionId] sort by Created_Time desc range from 0 to 9
Number insert_chat_message(Map data)                      # insert into ChatMessages -> new ID

# Package (track_package — inline single equality)
List fetch_packages_by_tracking(String trackingNumber)    # Package[Tracking_Number == trackingNumber] sort by Created_Time desc

# Service — per-condition ID helpers + final fetch + no-filter
List fetch_services_ids_by_type(String serviceType)       # Service[Service_Type == serviceType].ID.getAll()
List fetch_services_ids_by_destination(String destination)# Service[City == destination].ID.getAll()
List fetch_services_by_ids(List ids)                      # Service[ID in ids] sort by Service_ID range from 0 to 199
List fetch_services_all()                                 # Service[ID != 0] sort by Service_ID range from 0 to 199
# (sin fetch por origin: Service no tiene campo de origen; sort real por Service_ID, no Service_Name)

# Commercial_Office — SIN per-condition ID helpers (no hay City/Country top-level;
# son subfields del compuesto Address): fetch_all + filtro en memoria en la tool
List fetch_offices_by_ids(List ids)                       # Commercial_Office[ID in ids] sort by Office_Name range from 0 to 199
List fetch_offices_all()                                  # Commercial_Office[ID != 0] sort by Office_Name range from 0 to 199

# Coverage_Location — SIN per-condition ID helpers (no hay Country/Vendor/Service_Type
# top-level; Country se lee del compuesto Address_Information1): fetch_all + filtro
# country en memoria; serviceType/vendor se resuelven contra el módulo Vendor
# (Vendor_Type ↔ Service.Service_Type)
List fetch_coverage_by_ids(List ids)                      # Coverage_Location[ID in ids] sort by Location_Name range from 0 to 199
List fetch_coverage_all()                                 # Coverage_Location[ID != 0] sort by Location_Name range from 0 to 199

# Vendor — per-condition ID helpers + final fetch + no-filter
List fetch_vendors_ids_by_type(String serviceType)        # Vendor[Vendor_Type == serviceType && Active == true].ID.getAll()
List fetch_vendors_ids_by_name(String vendor)             # Vendor[Vendor_Name == vendor && Active == true].ID.getAll()
List fetch_vendors_by_ids(List ids)                       # Vendor[ID in ids] sort by Vendor_Name range from 0 to 199
List fetch_vendors_all()                                  # Vendor[ID != 0] sort by Vendor_Name range from 0 to 199

# Contacts — full_name filtra en MEMORIA sobre subcampos de First_Name (el composite
# no se compara a un string plano); phone/document usan .ID.getAll()
List fetch_contacts_ids_by_full_name(String fullName)     # Contacts[ID != 0] + match en memoria (First_Name.first_name/last_name, case-insensitive)
List fetch_contacts_ids_by_phone(String phone)            # Contacts[Mobile == phone].ID.getAll()
List fetch_contacts_ids_by_document(String document)      # Contacts[DNI == document].ID.getAll()
List fetch_contacts_by_ids(List ids)                      # Contacts[ID in ids] sort by First_Name range from 0 to 49
List fetch_contacts_all()                                 # Contacts[ID != 0] sort by First_Name range from 0 to 49
```

**REMOVED from surface**: `normalize_criteria`, `append_criteria`, and every `fetch_*(criteria-string)` helper.

Tool orchestration (the non-obvious pattern — `tool_services` example; native `List.addAll`/`intersect`):

```
targetIDs = List();
hasFilter = false;
if (serviceType != null && serviceType != "")  { targetIDs.addAll(fetch_services_ids_by_type(serviceType)); hasFilter = true; }
if (destination != null && destination != "")  { ids = fetch_services_ids_by_destination(destination);
                                                 if (hasFilter) { targetIDs = targetIDs.intersect(ids); }
                                                 else           { targetIDs.addAll(ids); hasFilter = true; } }
if (!hasFilter)                  { records = fetch_services_all(); }
else if (targetIDs.size() == 0)  { records = List(); }        // empty intersection -> data:[]
else                             { records = fetch_services_by_ids(targetIDs); }
// response mapping keeps fields.get("type") etc. (Map.get on record attributes — valid)
```

Coverage se desvía de este patrón por esquema real: Country/Vendor/Service_Type NO existen en
Coverage_Location → la tool filtra `country` en memoria sobre `Address_Information1.country`
y resuelve `serviceType`/`vendor` contra el módulo Vendor (`fetch_vendors_ids_by_type` /
`fetch_vendors_ids_by_name`, mismo ID-list + empty guard) devolviendo `{data: locations, vendors}`.

Contract notes: native clauses carry no quotes around field names; text values single-quoted; `insert into` returns numeric ID → new-session path refetches for a bound record; tool return maps and `chat_invoke` status contract unchanged; guard empty `targetIDs` before `[ID in []]` (Creator behavior unknown).

## Testing Strategy

No local runner — per-file Creator smoke checks before publish:

| Layer | What to Test | Approach (Creator) |
|---|---|---|
| data_access | Per-condition ID helpers (0/1/many matches), `_by_ids`, `_all` counts/order | Run each helper; verify `[ID != 0]` fetch-all and `[ID in ids]` sort/range |
| chat flows | Full turn end-to-end | Widget: session create/reuse, messages persist, `Status=answered` |
| chat_list + tools | User scoping; each tool 0/1/2+ params; limits/sorts/not-found; empty intersection | 2 users; per tool param combos; count ≤ limit, sort, empty `data:[]` |
| on_submit + regression | Failure path; history order | Force failure → `input.Status="failed"`; >10 messages → newest 10 |

## Migration / Rollout

No data migration. Publish order: `data_access` → `chat_common` → tools → `chat_invoke`/`chat_list`/`on_submit`; smoke test each before publish. Rollback: git revert per-file commit + re-publish prior code. **Pre-apply blockers**: rewrite Zia calls to the documented no-comma syntax (Open Question a, now resolved — see Decision above) and confirm `Form[ID != 0]` fetch-all per form (Open Question b).

## Open Questions

- [x] **(a) Zia task invocation syntax** — RESOLVED via official Zoho Deluge docs (Zia task): parameters are NOT comma-separated; each named parameter (`message`, `files`, `context`, `parameters`) goes on its own line inside `Zia[...]`. Apply phase must rewrite the calls in `chat_intent` and `compose_with_ai` to this form. A final editor smoke check still confirms the exact line/whitespace layout accepted by the Creator editor.
- [ ] **(b) `Form[ID != 0]` as fetch-all** — confirm at runtime for each Form (manual gate, same spirit as gate 5.1).
- [ ] **(c) Type match `ChatRequests[ID == requestId]`** — requestId arrives as String; ID is numeric. Only verifiable in Creator.

## Risks

| Risk | Mitigation |
|---|---|
| Field-literal drift: query field baked in data_access vs same field in `*Fields` config map (response reads) — a rename must hit both | Document the coupling (README field table); one smoke per helper |
| Branching per tool (0 / 1+ conditions) — wrong branch = empty or unfiltered result | Uniform ID pipeline (any-vs-none only); seed/intersect per spec; smoke 0/1/2+ params |
| Empty `targetIDs` → `Form[ID in []]` behavior unknown in Creator | Short-circuit `targetIDs.size() == 0` → `data:[]` without final fetch |
| NPE if post-insert refetch returns null (new session) | Keep `newRecords != null && size() > 0` guard; `on_submit` catches → `Status=failed` |
| Zia call syntax unconfirmed → apply blocked | Open Question (a); editor check before apply |
