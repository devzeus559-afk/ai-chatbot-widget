# Delta Spec: report-tools

Change: **report-top-customers** — adds the first metric/reporting tool `report_top_customers`, ranking customers by service frequency over a fixed 30-day window. New domain — all requirements are ADDED.

## ADDED Requirements

### Requirement: Catalog Registration

The system MUST register `report_top_customers` in the `chat_config` tools catalog so `chat_intent` can select it.

- MUST declare params `serviceType` (optional) and `limit` (optional, default 10)
- MUST enumerate in the description the exact picklist values: `Package Receipt`, `Locker`, `Store`, `Remittance`, `Recharge`, `Online Store`, `Other Services` — case-sensitive equality ("paquetería" maps to `Package Receipt`)

#### Scenario: Zia selects the tool

- GIVEN the question "lista los 10 clientes más frecuentes en el servicio paquetería"
- WHEN `chat_intent` matches a tool
- THEN it returns `report_top_customers` with `serviceType: "Package Receipt"`

#### Scenario: Description enumerates exact values

- GIVEN the catalog entry
- WHEN statically reviewed
- THEN the description lists all 7 picklist values with exact casing

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

### Requirement: Fixed 30-Day Window with Optional Type Filter

The tool MUST rank services within a fixed 30-day window on `Date_field1` (business date), optionally restricted by `serviceType`.

- MUST use a fixed 30-day window, never configurable
- MUST match `serviceType` exactly (case-sensitive)
- MUST treat missing/empty `serviceType` as no filter

#### Scenario: Type-filtered report

- GIVEN `serviceType: "Package Receipt"`
- WHEN the tool aggregates
- THEN only services with `Service_Type == "Package Receipt"` in the window count

#### Scenario: Unfiltered report

- GIVEN no `serviceType` param
- WHEN the tool aggregates
- THEN all services in the window count

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
