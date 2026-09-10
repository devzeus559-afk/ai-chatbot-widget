# Delta Spec: report-tools

Change: **report-top-customers** — adds the first metric/reporting tool `report_top_customers`, ranking customers by service frequency over a fixed 30-day window. New domain — all requirements are ADDED.

## ADDED Requirements

### Requirement: Catalog Registration

The system MUST register `report_top_customers` in the `chat_config` tools catalog so `chat_intent` can select it.

- MUST declare params `serviceType` (required) and `limit` (optional, default 10)
- MUST document `serviceType` as a `List<string>` with at least one element
- MUST enumerate in the description the exact picklist values: `Locker`, `Store`, `Recharge`, `Online Store`, `Other Services` — case-sensitive equality. `Package Receipt` and `Remittance` are OUT of this tool's domain (they route to `report_top_package_customers` / `report_top_remittance_customers`).

#### Scenario: Zia selects the tool

- GIVEN the question "lista los 10 clientes más frecuentes en el servicio Locker"
- WHEN `chat_intent` matches a tool
- THEN it returns `report_top_customers` with `serviceType: ["Locker"]`

#### Scenario: Description enumerates exact values

- GIVEN the catalog entry
- WHEN statically reviewed
- THEN the description lists all 5 picklist values with exact casing and excludes `Package Receipt`/`Remittance`

#### Scenario: Type omitted falls back to clarify

- GIVEN a vague "quiénes son los clientes más frecuentes" without a service type
- WHEN `chat_intent` considers the generic tool
- THEN it must either return a `clarify` or select a tool other than `report_top_customers` (it MUST NOT invoke the generic without `serviceType`)

### Requirement: Dispatch Routing

`dispatch_tool` MUST route `report_top_customers` to the tool function, returning its result unchanged.

#### Scenario: Tool dispatched

- GIVEN `chat_intent` returns tool `report_top_customers`
- WHEN `dispatch_tool` runs
- THEN the report function executes and its result returns

#### Scenario: Unknown tool fallback preserved

- GIVEN `chat_intent` returns an unregistered tool name
- WHEN `dispatch_tool` runs
- THEN the existing `{"ok": false, "message": "Herramienta desconocida: ..."}` fallback still returns

### Requirement: Fixed 30-Day Window with Mandatory Type Filter

The tool MUST rank services within a fixed 30-day window on `Date_field1` (business date), restricted by the mandatory `serviceType` list.

- MUST use a fixed 30-day window, never configurable
- MUST match each `serviceType` element exactly (case-sensitive)
- MUST require `serviceType` as a non-empty list; missing, empty, or non-list input returns `{"ok": false, "kind": "clarify", "message": "Debes especificar al menos un tipo de servicio."}` (no unfiltered mode)
- MUST union the ID sets of every requested type (`addAll`), then intersect with the window ID set

#### Scenario: Type-filtered report

- GIVEN `serviceType: ["Locker", "Store"]`
- WHEN the tool aggregates
- THEN only services with `Service_Type` in the requested list within the window count

#### Scenario: Multi-type union

- GIVEN `serviceType: ["Locker", "Store"]`
- WHEN the tool fetches IDs
- THEN the type ID sets are added together (union) and intersected with the window, not intersected type-by-type

#### Scenario: Missing type returns clarify

- GIVEN no `serviceType` param
- WHEN the tool validates
- THEN it returns `{"ok": false, "kind": "clarify"}` without ranking

### Requirement: Frequency Ranking with Seniority Tie-Break

The tool MUST count services per sender (`Sender_field`) and rank the top-N by frequency, ties by earliest service date first.

- MUST skip records with empty/null `Sender_field`
- MUST `toNumber()` `limit`, defaulting to 10 when missing or <= 0
- MUST normalize sender IDs to Number before name resolution via `fetch_contacts_by_ids` (top-N only)
- MUST rank with top-N insertion, O(n·limit), no full sort

#### Scenario: Tie ranked by seniority

- GIVEN two senders with equal counts
- WHEN ranking runs
- THEN the sender with the earliest `Date_field1` ranks first

#### Scenario: Empty sender ignored

- GIVEN a window record with empty `Sender_field`
- WHEN aggregating
- THEN it is not counted

### Requirement: 200-Record Cap and Truncated Flag

The tool MUST set `truncated: true` when the 30-day window count exceeds 200, and fetch at most 200 records for the ranking.

#### Scenario: Window exceeds cap

- GIVEN a window with 250 services
- WHEN the tool fetches
- THEN at most 200 records feed the ranking
- AND `truncated: true` is set

### Requirement: Spanish Template Reply, No LLM Composition

The tool MUST return `{"ok": true, "data": ...}` and the reply MUST compose a Spanish template listing rank, customer name, and count per customer.

- MUST keep `composeWithAI` false (ranking data never sent to the LLM)
- MUST include a truncation notice in the reply when `truncated` is true

#### Scenario: Reply with truncation notice

- GIVEN data with `truncated: true`
- WHEN `format_top_customers` composes
- THEN the Spanish reply lists the top customers and notes the ranking is approximate

### Requirement: Scope Rule Amendment

The project MUST amend the `openspec/config.yaml` proposal rule "Keep scope aligned with the 5 business tools" so it includes metric/reporting tools.

#### Scenario: Rule updated

- GIVEN the `rules.proposal` section
- WHEN statically reviewed
- THEN the rule text no longer limits scope to the 5 lookup tools (6th metric tool registered)
