# Hierarchical Intent Routing Specification

## Purpose

Decompose the monolithic Zia call into a 3-step hierarchical pipeline (category → tool → params) with a fixed taxonomy of 5 tool categories. Each Zia call evaluates a tiny decision space, reducing clarification bounces on ambiguous queries.

## Requirements

### Requirement: Tool Category Taxonomy

The system MUST classify every tool request into one of 5 categories. The taxonomy MUST be defined in `chat_config.deluge`.

| Category | Tools (count) |
|---|---|
| SEARCH | search_services, find_offices, check_coverage, find_contacts (4) |
| TRACKING | track_package (1) |
| TOP_CUSTOMERS | report_top_customers, report_top_package_customers, report_top_remittance_customers (3) |
| PACKAGE_ANALYSIS | report_pounds_shipped, report_daily_average, report_monthly_comparison (3) |
| OTHER_ANALYSIS | report_shipping_type_frequency, report_merchandise_type, report_delayed_packages, report_unscanned_packages (4) |

- Each tool MUST belong to exactly one category
- `chat_config` MUST expose `toolsByCategory` (category → tool name list) and `toolsTextByCategory` (category → Zia prompt fragment)

#### Scenario: Category covers all 15 tools

- GIVEN the 15 tools registered in `chat_config`
- WHEN `toolsByCategory` is built
- THEN every tool appears in exactly one category
- AND no tool is missing or duplicated

### Requirement: resolve_category (Call 1)

`resolve_category(prompt, history)` MUST classify the user prompt into exactly one of: SEARCH, TRACKING, TOP_CUSTOMERS, PACKAGE_ANALYSIS, OTHER_ANALYSIS, SEARCH_ACK (greeting/generic), or OUT_OF_SCOPE.

- MUST return `{"category": "<NAME>"}` on success
- MUST return `{"clarify": "..."}` or `{"answer": "..."}` for greetings/out-of-scope
- MUST use `temperature: 0.1`
- MUST NOT return null — null MUST be caught and converted to a generic clarify

#### Scenario: Clear category classification

- GIVEN a prompt like "rastrear P-123456"
- WHEN `resolve_category` runs
- THEN it returns `{"category": "TRACKING"}`

#### Scenario: Greeting returns SEARCH_ACK

- GIVEN a greeting prompt like "hola, ¿cómo estás?"
- WHEN `resolve_category` runs
- THEN it returns `{"answer": "..."}` with a friendly greeting response

#### Scenario: Out-of-scope returns answer or clarify

- GIVEN a prompt unrelated to logistics (e.g. "¿qué es Bitcoin?")
- WHEN `resolve_category` runs
- THEN it returns `{"clarify": "Lo siento, solo puedo ayudarte con temas de paquetería, remesas y recargas."}`

#### Scenario: Null Zia response returns generic clarify

- GIVEN a Zia API failure or null response
- WHEN `resolve_category` runs
- THEN it returns `{"clarify": "No pude interpretar tu solicitud. ¿Puedes reformularla?"}`

### Requirement: resolve_tool (Call 2)

`resolve_tool(prompt, category, filteredCatalog)` MUST select the exact tool within a category.

- MUST receive the sub-catalog for the chosen category (max 4 tools)
- Each sub-catalog entry MUST include: tool name, short description, required params hint
- MUST return `{"tool": "<name>", "params": {...}}` or `{"clarify": "..."}`
- MUST use `temperature: 0.1`
- MUST only return tool names present in the filtered sub-catalog

#### Scenario: Tool resolved from sub-catalog

- GIVEN category TOP_CUSTOMERS and a prompt "clientes más frecuentes de paquetería"
- WHEN `resolve_tool` runs with sub-catalog [report_top_customers, report_top_package_customers, report_top_remittance_customers]
- THEN it returns `{"tool": "report_top_package_customers", "params": {...}}`

#### Scenario: Ambiguous prompt within category returns clarify

- GIVEN a prompt where the specific tool within a category is ambiguous
- WHEN `resolve_tool` runs
- THEN it returns `{"clarify": "..."}` with a targeted question

### Requirement: resolve_params (Call 3)

`resolve_params(prompt, toolName, paramSchema)` MUST extract parameters for the selected tool.

- MUST receive the single-tool param schema (required/optional fields + enum constraints)
- MUST return `{"tool": "<name>", "params": {...}}` with all validated parameters
- MUST use `temperature: 0.1`
- MUST respect required-field rules: if a required param is missing (e.g. trackingNumber, serviceType List≥1), MUST return `{"clarify": "..."}`

#### Scenario: Optional params omitted correctly

- GIVEN a tool with optional params (e.g. find_offices with city/country)
- WHEN the user provides only city
- THEN params contain only `{"city": "Miami"}` — no null/empty values for absent fields

#### Scenario: Required param missing returns clarify

- GIVEN track_package and the user omits the tracking number
- WHEN `resolve_params` runs
- THEN it returns `{"clarify": "Necesito el número de seguimiento..."}`

### Requirement: Period Enum Resolution

Zia MUST NOT calculate dates. `resolve_params` MUST return a `period` enum string; `chat_common.resolve_period()` MUST convert it to a `startDate`/`endDate` pair.

The period enum values and their date calculations:

| Enum | startDate | endDate |
|---|---|---|
| `ultimo_mes` | `zoho.currentdate.subDay(30)` | `zoho.currentdate` |
| `mes_anterior` | `first_of_month(now.addMonth(-1))` | `first_of_month(now).subDay(1)` |
| `este_mes` | `first_of_month(now)` | `zoho.currentdate` |
| `ultimos_7_dias` | `zoho.currentdate.subDay(7)` | `zoho.currentdate` |

- MUST treat "último mes" and "últimos 30 días" as identical (both → `ultimo_mes`)
- MUST treat explicit user dates as overriding the period enum
- `resolve_period()` MUST be defined in `chat_common.deluge`

#### Scenario: ultimo_mes maps to 30-day window

- GIVEN Zia returns `{"period": "ultimo_mes"}`
- WHEN `resolve_period("ultimo_mes")` runs
- THEN startDate = 30 days before today
- AND endDate = today

#### Scenario: mes_anterior is a full calendar month

- GIVEN Zia returns `{"period": "mes_anterior"}`
- WHEN `resolve_period("mes_anterior")` runs on September 10
- THEN startDate = August 1
- AND endDate = August 31

#### Scenario: este_mes is current month to today

- GIVEN Zia returns `{"period": "este_mes"}`
- WHEN `resolve_period("este_mes")` runs on September 10
- THEN startDate = September 1
- AND endDate = September 10

#### Scenario: explicit dates override period enum

- GIVEN Zia returns both `{"period": "ultimo_mes", "startDate": "2025-01-01", "endDate": "2025-01-31"}`
- WHEN the tool processes params
- THEN the explicit startDate/endDate values MUST be used, NOT the period enum

### Requirement: Optional Filters Combinability

Report tools MUST support 0, 1, or multiple optional filter params in any combination.

- When a filter param is absent from the user prompt, it MUST be omitted from the params (not null, not empty string)
- Required filters (trackingNumber for track_package; serviceType as List≥1 for report_top_customers) MUST trigger a specific clarify if missing
- All other params are optional and follow the existing omit-if-absent rule

#### Scenario: Zero optional filters

- GIVEN a prompt with no filter criteria (e.g. "clientes más frecuentes")
- WHEN params are resolved
- THEN only required params are present; optional params are absent

#### Scenario: Multiple optional filters combined

- GIVEN a prompt like "libras enviadas en Miami en marzo"
- WHEN `resolve_params` runs for report_pounds_shipped
- THEN params contain `{"office": "Miami", "period": "mes_anterior"}`

#### Scenario: Required filter missing triggers specific clarify

- GIVEN report_top_customers and no serviceType in the prompt
- WHEN `resolve_params` runs
- THEN it returns `{"clarify": "¿Qué tipo de servicio te interesa? (Locker, Store, Recharge, Online Store, Other Services)"}`

### Requirement: Out-of-Scope Handling

Prompts outside the logistics domain MUST be handled at `resolve_category` level.

- Greetings/acknowledgments → `{"answer": "..."}` (SEARCH_ACK)
- Fully unrelated topics → `{"clarify": "..."` with domain reminder
- The clarify message for out-of-scope MUST mention the supported domains: paquetería, remesas, recargas

#### Scenario: Unrelated question returns clarify with domain scope

- GIVEN a prompt like "¿cuál es el capital de Francia?"
- WHEN `resolve_category` runs
- THEN it returns clarify mentioning supported logistics domains
