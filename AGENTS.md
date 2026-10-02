# AGENTS.md — ai-chatbot-widget

## No automated tests — verification is static + manual in Zoho Creator

- Deluge runs **only** inside Zoho Creator. There is no local runner, no `go test`, no `npm test`.
- The Node server (`chatbot-widget/server/index.js`) is unmodified Zoho boilerplate with zero business logic.
- Test scaffolds exist as Deluge functions (`deluge/core/tests_*.deluge`) but they run **manually in Creator**, never locally.
- Do **not** force TDD or write test scaffolds — verification means static review of `.deluge` files + manual checks in Creator.
- To verify a Deluge change: read the diff for correct syntax, confirm the function name matches the file definition, and list the manual Creator check (e.g. "submit a ChatRequest with tracking X and verify Status→answered").

## Branch & commits

- Working branch: `develop` (not `main`).
- Conventional commits: `feat|fix|refactor|docs` + scope, e.g. `feat(deluge): add tool_X`, `fix(widget): sort history by ID`.
- No CI, no pre-commit hooks. Lint/typecheck/test commands do not exist.
- `creatorapp-backup/Logistic_Management_II.ds` is a user-owned Creator dump: **never commit or touch it**. It is gitignored and serves as a read-only input for `tools/creator-parity.js`.

## Repo ↔ live drift — a committed `.deluge` file is not a deployed one

Nothing in git records what actually reached Creator, so a function can be committed and merged while production still runs the old version. `tools/creator-parity.js` compares the repo against the live app export:

```bash
node tools/creator-parity.js             # exit 1 if drifted
node tools/creator-parity.js --verbose   # show the differing segments
node tools/creator-parity.js --json      # machine-readable
```

| Bucket | Meaning | Action |
|---|---|---|
| *in repo, not in live* | written and committed, never deployed | paste it into Creator |
| *different bodies* | repo holds newer edits | re-paste, or re-export the `.ds` if the dump is stale |
| *tests also drifting* | informational only | test scaffolds are Creator-run, not production logic |

Run it before reporting any Deluge change as done, and again after deploying. It only proves parity against the **dump**, so a stale `.ds` reads as false drift — re-export from Creator when results look wrong.

**Deploy callers and callees together.** When a function's arity or signature changed, deploying the caller alone breaks production. `--verbose` exposes arity differences; treat any `different bodies` entry whose signature line appears in the diff as a hard ordering constraint.

## Dev server (widget preview)

```bash
cd chatbot-widget && npm install && npm start
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
- `chat_invoke` is the server-side orchestrator. It calls `chat_config()` first, then chains: session → user message → Zia intent → tool dispatch → compose → AI message → update session (update uses in-memory field mutation, not an API call).
- Zia returns strict JSON: `{"tool","params"}` / `{"answer"}` / `{"clarify"}`. `dispatch_tool` in `chat_invoke` is an **if-chain** (not a Deluge `switch`) that maps tool names to `thisapp.chat_tools.<name>(params)` calls; default returns `Herramienta desconocida`.
- `composeWithAI: false` (default) = deterministic template replies. Set `true` for a second Zia call to redact natural responses (more cost/latency).

## Deluge constraints — these will break your code if ignored

1. **`Form[criteriaVar]` is INVALID.** The field in `Form[...]` must be a literal, never a variable. Filter with:
   - 0 conditions → `Form[ID != 0]`
   - 1 condition → `Form[Field == valueVar]` (literal field, variable value)
   - 2+ conditions (AND) → `.ID.getAll()` per condition, `addAll`/`intersect`, guard empty, final `Form[ID in targetIDs]`
2. **Every function must start with `config = chat_config();`** — Deluge shares no global state between functions.
3. **Linked records are mutable**: `request.Status = "answered"` persists directly (the On Submit workflow relies on this — it catches failures by mutating `input` in memory, 0 Creator API calls). `insert into` does NOT trigger On Validate/On Success.
4. **Record limits**: business modules `range 0 to 199` (200 max), contacts `range 0 to 49` (50 max), chat history last 10.
5. **Zia task syntax**: parameters on separate lines, NO commas between named parameters.
6. **`Form[ID in []]`** behavior is unknown in Creator — always guard with an empty-list check before fetching.

## Link names — report vs form (widget CONFIG mismatch pitfall)

The widget needs **two sets** of link names in `CONFIG`:
- **Report link names** (`chatSessionsReport: "ChatSessions_Report"`, `chatMessagesReport: "ChatMessages_Report"`, `chatRequestsReport: "ChatRequests_Report"`) — used with `getAllRecords`
- **Form link names** (`chatSessionsForm: "ChatSessions"`, `chatMessagesForm: "ChatMessages"`, `chatRequestsForm: "ChatRequests"`) — used with `addRecord`/`deleteRecord`

These are often different in Creator. The `CONFIG.appName` uses the real app link name (`copy-1-of-logistic-management-ii`). Field link names live in `CONFIG.chatRequestsFields` (`Session_ID`, `Prompt`). Polling: 1500 ms interval, 45 s timeout; `forceLocal` toggles local mode. The backend Deluge uses **native data access** (no `appName`, no `zoho.creator` calls).

## File ownership

| Directory | What it owns | Touch rules |
|---|---|---|
| `deluge/config/` | `chat_config.deluge` — link names, currency, `composeWithAI`, `tools` catalog (16 tools), `toolsText` builder. Field maps / `ownerFields` do **not** exist here | Every tool/field change ripples here |
| `deluge/core/` | `data_access` (native query layer with literal field names), `chat_common`, `chat_intent`, `chat_invoke`, `chat_list` + manual test files `tests_common`, `tests_chat_intent`, `tests_native_data_access`, `tests_report_top_customers` | Query field names are literals in `data_access` — keep them in sync with the Creator schema; no central field map to update |
| `deluge/tools/` | One `tool_*.deluge` per business tool (16 files) | Each starts with `config = chat_config()`; returns `{"ok": true/false, "data": [...]}` |
| `deluge/workflow/` | `on_submit_chatrequests.deluge` — On Submit script for ChatRequests | Calls `chat_invoke`; catches failures by mutating `input` in memory so no request stays "pending" |
| `tools/` | `creator-parity.js` — repo ↔ live Deluge drift report | Node, no dependencies. Read-only: never writes the `.ds` or the Deluge sources |
| `chatbot-widget/app/widget.html` | Single-file widget (UI + adapter + CSS + i18n) | Vanilla JS, no framework; `CONFIG` block inside for link names; i18n strings in `chatbot-widget/app/translations/en.json` |

## Composite fields — the gotcha that repeats

Creator has `name` and `address` field types (composite). You **cannot** filter a composite field as a whole with `Form[First_Name == "John"]`. Instead:
- **Filter**: query a different indexed field (e.g. `DNI`, `Mobile`) or scan in memory (see `fetch_contacts_ids_by_full_name` in `data_access` — filters `first_name`/`last_name` subfields in a loop).
- **Read**: use dot notation on the fetched record: `rec.get("First_Name").get("first_name")`.
- **Subfields in criteria are OK**: `Contacts[Address.state_province == ...]` works — it is only the whole composite value that cannot be matched against a plain string. In-memory subfield filtering is the deterministic approach used by the tools.

## Business tools catalog

16 tools registered in `chat_config`'s `tools` list (Zia catalog, in order):

Lookup (5):
1. `track_package` — package status by tracking number
2. `search_services` — services by type/destination (filters on `Service_Type`, `City`)
3. `find_offices` — offices by city/country (filters on `Address` subfields)
4. `check_coverage` — coverage by country + vendors by service type/name (bridges `Coverage_Location` ↔ `Vendor` via `Vendor_Type`)
5. `find_contacts` — contacts by name/phone/document

Reporting (10):
6. `report_top_customers` — top N customers by service count in 30-day window on `Date_field1`
7. `report_top_package_customers` — top customers by package service count
8. `report_top_remittance_customers` — top customers by remittance service count
9. `report_shipping_type_frequency` — shipping type frequency breakdown
10. `report_merchandise_type` — merchandise type breakdown
11. `report_pounds_shipped` — pounds shipped reporting
12. `report_daily_average` — daily average metrics
13. `report_monthly_comparison` — month-over-month comparison
14. `report_delayed_packages` — delayed package analysis
15. `report_unscanned_packages` — unscanned package analysis
16. `list_service_types` — static catalog of the agency's 7 service types (no Zia, no data access)

Tool file naming drops the verb prefix: `tool_services.deluge`, `tool_offices.deluge`, `tool_coverage.deluge`, `tool_contacts.deluge`, `tool_service_types.deluge`, `tool_report_top_customers.deluge`, etc.

When adding a tool: register in `chat_config` `tools` list + `toolsText`, add `dispatch_tool` if-chain case in `chat_invoke`, create `deluge/tools/tool_*.deluge`, add data helpers in `data_access.deluge` if needed.

## SDD (spec-driven development) config

`openspec/config.yaml` is the SDD source of truth. Key rules from it:
- Proposals must include rollback plan; keep scope aligned with the tools catalog.
- Specs use Given/When/Then + RFC 2119 keywords.
- Design must document Zoho Creator constraints (40s Zia timeout, 45s polling, 200 record max, no global Deluge state).
- Tasks are hierarchical, grouped by phase, separated by Deluge/widget/server.
- Planned changes live under `openspec/changes/`; completed ones are archived to `openspec/changes/archive/<yyyy-mm-dd>-<change>/` (proposal, specs, design, tasks, `verify-report.md`, `archive-report.md`). Current main specs live in `openspec/specs/` (`chat-conversation-flows`, `data-access-layer`, `lookup-tools`, `report-tools`, `widget-export`).

## Useful reference files

- `deluge/README.md` — full backend setup guide (module schemas, function list, field mapping, composite-field caveat)
- `deluge/METRICS.md` — metric tracking (manual verification states, pending Creator deploys)
- `tools/creator-parity.js` — repo ↔ live drift report; run before claiming a Deluge change is deployed
- `README.md` (root) — architecture diagram, widget flow, configuration checklist
- `deluge/config/chat_config.deluge` — the single source of truth for all link names and the 16-tool catalog
- `openspec/config.yaml` — SDD rules, testing constraints, commit conventions
- `chatbot-widget/app/translations/en.json` — widget i18n strings