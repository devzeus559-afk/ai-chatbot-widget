# AGENTS.md — ai-chatbot-widget

## No automated tests — verification is static + manual in Zoho Creator

- Deluge runs **only** inside Zoho Creator. There is no local runner, no `go test`, no `npm test`.
- The Node server (`LM2Chatbot/server/index.js`) is unmodified Zoho boilerplate with zero business logic.
- Do **not** force TDD or write test scaffolds — verification means static review of `.deluge` files + manual checks in Creator.
- To verify a Deluge change: read the diff for correct syntax, confirm the function name matches the file definition, and list the manual Creator check (e.g. "submit a ChatRequest with tracking X and verify Status→answered").

## Branch & commits

- Working branch: `develop` (not `main`).
- Conventional commits: `feat|fix|refactor|docs` + scope, e.g. `feat(deluge): add tool_X`, `fix(widget): sort history by ID`.
- No CI, no pre-commit hooks. Lint/typecheck/test commands do not exist.

## Dev server (widget preview)

```bash
cd LM2Chatbot && npm install && npm start
# HTTPS on localhost:5000-5009, self-signed cert
# Open /app to see widget.html in "local" mode (localStorage, simulated responses)
```

The server is for **preview only** — it serves `widget.html` statically. The real runtime is Zoho Creator with the Client API.

## Architecture — async job, no Creator API from widget

```
Widget ──addRecord(ChatRequests)──▶ On Submit workflow
  ◀──poll Status──────────────────── chat_invoke → chat_intent(Zia) → dispatch_tool → compose_reply
```

- Widget uses **Client API only** (`addRecord`, `getAllRecords`, `deleteRecord`).
- `chat_invoke` is the server-side orchestrator. It calls `chat_config()` first, then chains: session → user message → Zia intent → tool dispatch → compose → AI message → update session.
- Zia returns strict JSON: `{"tool","params"}` / `{"answer"}` / `{"clarify"}`. The `dispatch_tool` switch maps tool names to `tool_*` functions.
- `composeWithAI: false` (default) = deterministic template replies. Set `true` for a second Zia call to redact natural responses (more cost/latency).

## Deluge constraints — these will break your code if ignored

1. **`Form[criteriaVar]` is INVALID.** The field in `Form[...]` must be a literal, never a variable. Filter with:
   - 0 conditions → `Form[ID != 0]`
   - 1 condition → `Form[Field == valueVar]` (literal field, variable value)
   - 2+ conditions (AND) → `.ID.getAll()` per condition, `addAll`/`intersect`, guard empty, final `Form[ID in targetIDs]`
2. **Every function must start with `config = chat_config();`** — Deluge shares no global state between functions.
3. **Linked records are mutable**: `request.Status = "answered"` persists directly. `insert into` does NOT trigger On Validate/On Success.
4. **Record limits**: business modules `range 0 to 199` (200 max), contacts `range 0 to 49` (50 max), chat history last 10.
5. **Zia task syntax**: parameters on separate lines, NO commas between named parameters.
6. **`Form[ID in []]`** behavior is unknown in Creator — always guard with an empty-list check before fetching.

## Link names — report vs form (widget CONFIG mismatch pitfall)

The widget needs **two sets** of link names in `CONFIG`:
- **Report link names** (`chatSessionsReport`, `chatMessagesReport`, `chatRequestsReport`) — used with `getAllRecords`
- **Form link names** (`chatSessionsForm`, `chatMessagesForm`, `chatRequestsForm`) — used with `addRecord`/`deleteRecord`

These are often different in Creator. The `CONFIG.appName` uses the real app link name (`copy-1-of-logistic-management-ii`). The backend Deluge uses **native data access** (no `appName` needed).

## File ownership

| Directory | What it owns | Touch rules |
|---|---|---|
| `deluge/config/` | `chat_config.deluge` — link names, field maps, tool catalog, ownerFields | Every tool/field change ripples here |
| `deluge/core/` | data_access, chat_common, chat_intent, chat_invoke, chat_list | `data_access` has literal field names — update both the query AND the config field map |
| `deluge/tools/` | One `tool_*.deluge` per business tool | Each starts with `config = chat_config()`; returns `{"ok": true/false, "data": [...]}` |
| `deluge/workflow/` | On Submit script for ChatRequests | Just calls `chat_invoke` |
| `LM2Chatbot/app/widget.html` | Single-file widget (UI + adapter + CSS + i18n) | Vanilla JS, no framework; `CONFIG` block at top for link names |

## Composite fields — the gotcha that repeats

Creator has `name` and `address` field types (composite). You **cannot** do `Form[First_Name == "John"]` on a composite field. Instead:
- **Filter**: query a different indexed field (e.g. `DNI`, `Mobile`) or scan in memory (see `fetch_contacts_ids_by_full_name` — scans up to 999 records, filters `first_name`/`last_name` subfields in a loop).
- **Read**: use dot notation on the fetched record: `rec.get("First_Name").get("first_name")`.
- **Config maps**: the `*Fields` maps in `chat_config` use the **top-level** composite field name; the tool reads subfields from the map value.

## Business tools catalog

Six tools registered in `chat_config`'s `tools` list:
1. `track_package` — package status by tracking number
2. `search_services` — services by type/destination (filters on `Service_Type`, `City`)
3. `find_offices` — offices by city/country (filters on `Address` subfields)
4. `check_coverage` — coverage by country + vendors by service type/name (bridges `Coverage_Location` ↔ `Vendor` via `Vendor_Type`)
5. `find_contacts` — contacts by name/phone/document
6. `report_top_customers` — top N customers by service count in 30-day window on `Date_field1`

When adding a tool: register in `chat_config` tools list + `toolsText`, add `dispatch_tool` case in `chat_invoke`, create `deluge/tools/tool_*.deluge`, add data helpers in `data_access.deluge` if needed.

## SDD (spec-driven development) config

`openspec/config.yaml` is the SDD source of truth. Key rules from it:
- Proposals must include rollback plan; keep scope aligned with the tools catalog.
- Specs use Given/When/Then + RFC 2119 keywords.
- Design must document Zoho Creator constraints (40s Zia timeout, 45s polling, 200 record max, no global Deluge state).
- Tasks are hierarchical, grouped by phase, separated by Deluge/widget/server.

## Useful reference files

- `deluge/README.md` — full backend setup guide (module schemas, function list, field mapping)
- `README.md` (root) — architecture diagram, widget flow, configuration checklist
- `deluge/config/chat_config.deluge` — the single source of truth for all link names, field maps, and tool definitions
- `openspec/config.yaml` — SDD rules, testing constraints, commit conventions
