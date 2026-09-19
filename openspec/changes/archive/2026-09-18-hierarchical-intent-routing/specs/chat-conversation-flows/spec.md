# Delta for Chat Conversation Flows

## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: Unknown Tool Fallback

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
