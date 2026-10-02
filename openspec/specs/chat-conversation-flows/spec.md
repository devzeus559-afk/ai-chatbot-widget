# Chat Conversation Flows Specification

## Purpose

`chat_invoke`, `chat_list`, and `on_submit_chatrequests` run entirely on the native data-access layer: 0 external + 0 Developer API calls per chat turn (Zia aside), with behavior parity to the previous `zoho.creator.*` flow.

## Requirements

### Requirement: Zero-API Chat Turn

A full chat turn MUST complete without any `zoho.creator.*` call; all reads and writes use native access. The 3-Zia-call hierarchical pipeline runs entirely server-side within the existing On Submit workflow. `chat_invoke` is NOT modified.

(Previously: Single Zia call in `chat_intent`, now replaced by 3-call hierarchical pipeline — same external contract, different internal routing.)

- MUST resolve the request via `ChatRequests[ID == requestId]`
- MUST resolve the session via `ChatSessions[Session_ID == sessionId]`
- MUST pass the field name as a literal and the value as a variable (single-equality inline) — MUST NOT build a criteria string variable (`Form[criteriaVar]` is invalid in Creator)
- MUST insert new sessions/messages via `insert into`
- MUST mark the request answered by mutating the fetched request record

#### Scenario: Full turn executes natively

- GIVEN a valid request ID
- WHEN `chat_invoke` runs
- THEN no `zoho.creator.*` call executes
- AND the request ends with `Status = answered`

### Requirement: Behavior Parity

The flows MUST return the same data, limits, and ordering as the current API-based implementation, EXCEPT history, which is intentionally newest-first (see History Returns Newest 10).

#### Scenario: Identical result set

- GIVEN the same request under both implementations
- WHEN results are compared
- THEN replies and session titles are identical, and history contains the same 10 newest messages (order intentionally differs: newest-first)

### Requirement: Session Exists vs New Session

The system MUST reuse an existing session when one matches and create it otherwise.

- MUST return the fetched record via `.get(0)` when the collection is non-empty (`.size() > 0`)
- MUST insert a new session with Session_ID, Title, User, Last_Activity when empty

#### Scenario: Existing session reused

- GIVEN a session with Session_ID X exists
- WHEN `get_or_create_session` runs
- THEN the existing fetched record is returned
- AND no insert executes

#### Scenario: New session created

- GIVEN no session matches Session_ID X
- WHEN `get_or_create_session` runs
- THEN a new ChatSessions record is inserted
- AND its ID persists the user message

### Requirement: Request Not Found

The system MUST return `{"status": "failed", "message": "Solicitud no encontrada"}` when the request is not found, using the collection empty check (`.size() == 0`).

#### Scenario: Unknown request ID

- GIVEN a requestId with no matching ChatRequests record
- WHEN `chat_invoke` resolves the request
- THEN it returns the failed status with the not-found message
- AND no session, message, or tool work runs

### Requirement: History Returns Newest 10 (Newest-First)

The system MUST return the newest 10 messages of a session, ordered newest-first (descending by `Created_Time`), and MUST pass them to `chat_intent` in that order.

- MUST fetch via native range 0–9 sorted by `Created_Time desc`
- MUST NOT reverse the result — this is an intentional behavior change (today trims the last 10 oldest-first; the new flow is newest-first)

#### Scenario: Long history

- GIVEN a session with 25 messages
- WHEN `get_recent_history` runs
- THEN exactly 10 messages return
- AND they are the newest 10, newest message first

#### Scenario: Short history

- GIVEN a session with 3 messages
- WHEN `get_recent_history` runs
- THEN all 3 return in descending order (newest first)

### Requirement: Session Update via Fetched Record

The system MUST pass the mutable fetched session record to `update_session` (never a fresh Map).

- MUST set Title (first prompt, truncated to 50) and Last_Activity when Title is blank/default
- MUST set Last_Activity only when a custom Title exists

#### Scenario: Default title replaced

- GIVEN a fetched record with Title "Nueva conversación" and a prompt longer than 50 chars
- WHEN `update_session` runs
- THEN Title becomes the first 50 chars of the prompt
- AND Last_Activity updates with no API call



The system MUST return `{"ok": false, "message": "Herramienta desconocida: <name>"}` for an unknown tool name.

- `dispatch_tool` in `chat_invoke` is NOT modified
- `resolve_tool` in the hierarchical pipeline MUST only return tool names from the filtered sub-catalog (max 4 tools per category)
- If `resolve_tool` returns a tool name not in the filtered catalog, the pipeline MUST treat it as a routing error and return a generic clarify

#### Scenario: Unknown tool from Zia

- GIVEN `chat_intent` returns an unknown tool
- WHEN `dispatch_tool` runs
- THEN ok:false with the unknown-tool message returns

#### Scenario: Tool outside filtered catalog

- GIVEN `resolve_tool` returns a tool name not in the requested category's sub-catalog
- WHEN the pipeline validates the response
- THEN `chat_intent` returns a generic clarify
- AND `dispatch_tool` is never called
### Requirement: Failure Status via Input Mutation

`on_submit_chatrequests` MUST mark failed requests by mutating the in-memory `input` record — 0 API calls.

- MUST set `input.Status = "failed"` and `input.Error` when `chat_invoke` returns a non-answered status or throws

#### Scenario: Failure path mutates input

- GIVEN `chat_invoke` returns status != "answered" (or throws)
- WHEN `on_submit` runs
- THEN `input.Status` and `input.Error` are set in memory
- AND no `zoho.creator.*` call executes
### Requirement: Hierarchical Intent Routing Pipeline

`chat_intent()` MUST delegate to a 3-Zia-call pipeline (`resolve_category` → `resolve_tool` → `resolve_params`) and return the SAME external contract as today: `{"tool","params"}`, `{"answer"}`, or `{"clarify"}`. The internal pipeline is invisible to `chat_invoke`.

- MUST preserve the signature `chat_intent(string userPrompt, list history)`
- MUST return exactly the same three-contract shapes the current monolithic call returns
- MUST short-circuit: if any Zia call returns `clarify` or `answer`, the pipeline MUST stop and return immediately without calling subsequent stages

#### Scenario: Clear category routes to tool

- GIVEN a user prompt that unambiguously targets a single tool category
- WHEN `chat_intent` runs
- THEN `resolve_category` returns a valid category name
- AND `resolve_tool` returns `{"tool": "<name>", "params": {...}}`
- AND `resolve_params` refines params if needed
- AND `chat_invoke` receives the standard tool contract

#### Scenario: Clarify at category stage short-circuits

- GIVEN a prompt with insufficient context to classify (e.g. "¿qué es Bitcoin?")
- WHEN `resolve_category` returns `{"clarify": "..."}`
- THEN `chat_intent` returns the clarify immediately
- AND no `resolve_tool` or `resolve_params` call executes

#### Scenario: Answer at any stage short-circuits

- GIVEN a greeting or out-of-scope prompt
- WHEN `resolve_category` returns `{"answer": "..."}`
- THEN `chat_intent` returns the answer immediately
- AND no further Zia calls execute

#### Scenario: Null Zia response returns generic clarify

- GIVEN a Zia call returns null (API failure, timeout, IA disabled)
- WHEN any pipeline stage receives a null response
- THEN `chat_intent` returns `{"clarify": "No pude interpretar tu solicitud. ¿Puedes reformularla?"}`
- AND no subsequent stages execute

### Requirement: Pipeline Latency Budget

The 3-Zia-call pipeline MUST complete within the existing latency envelope.

- MUST NOT exceed 40 seconds total (Zia timeout constraint)
- SHOULD complete within 30 seconds (widget polling budget with margin)
- Each Zia call MUST use `temperature: 0.1` for deterministic routing

#### Scenario: Normal latency within budget

- GIVEN a standard user prompt
- WHEN the 3-Zia-call pipeline executes
- THEN total latency MUST be under 40 seconds
- AND `chat_invoke` receives the result before the widget's 45-second polling timeout

#### Scenario: Slow Zia call within timeout

- GIVEN one Zia call takes longer than average (up to 12s)
- WHEN the pipeline executes
- THEN total latency MUST still be under 40 seconds
- AND a null-guard per call prevents cascading failures

