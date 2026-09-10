# Delta Spec: chat-conversation-flows

Change: **native-data-access** — migrates `chat_invoke`, `chat_list`, and `on_submit_chatrequests` to the native data-access layer (0 external + 0 Developer API calls per turn). This domain is new (no prior formal spec), so all requirements are ADDED.

## ADDED Requirements

### Requirement: Zero-API Chat Turn

A full chat turn MUST complete without any `zoho.creator.*` call; all reads and writes use native access.

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

### Requirement: Session List (chat_list)

`chat_list` MUST resolve `userId = zoho.loginuser.get("Id")` first, then fetch the logged-in user's sessions via `ChatSessions[User == userId] sort by Last_Activity desc` and return `{"ok": true, "data": [{id, title, lastActivity}, ...]}`.

- MUST scope to the current user only (multi-user behavior preserved)

#### Scenario: Sessions listed for current user

- GIVEN sessions exist for the logged-in user and for other users
- WHEN `chat_list` runs
- THEN ok:true with only the logged-in user's sessions, sorted by Last_Activity desc

#### Scenario: No sessions

- GIVEN the logged-in user has no sessions
- WHEN `chat_list` runs
- THEN ok:true with an empty data list

### Requirement: Unknown Tool Fallback

The system MUST return `{"ok": false, "message": "Herramienta desconocida: <name>"}` for an unknown tool name.

#### Scenario: Unknown tool from Zia

- GIVEN `chat_intent` returns an unknown tool
- WHEN `dispatch_tool` runs
- THEN ok:false with the unknown-tool message returns

### Requirement: Failure Status via Input Mutation

`on_submit_chatrequests` MUST mark failed requests by mutating the in-memory `input` record — 0 API calls.

- MUST set `input.Status = "failed"` and `input.Error` when `chat_invoke` returns a non-answered status or throws

#### Scenario: Failure path mutates input

- GIVEN `chat_invoke` returns status != "answered" (or throws)
- WHEN `on_submit` runs
- THEN `input.Status` and `input.Error` are set in memory
- AND no `zoho.creator.*` call executes
