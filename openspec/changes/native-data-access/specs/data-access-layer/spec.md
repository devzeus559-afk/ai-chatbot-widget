# Delta Spec: data-access-layer

Change: **native-data-access** — introduces the central native Zoho Creator access module (`deluge/core/data_access.deluge`) and removes every `zoho.creator.*` Developer API call. This domain is new (no prior formal spec), so all requirements are ADDED.

## ADDED Requirements

### Requirement: Native Fetch Wrapper

The system MUST provide per-form fetch helpers that read records with native `Form[...]` syntax, literal form link names, sort fields, and range, returning a COLLECTION.

- MUST accept filter params as (literal field name, value variable) pairs — NEVER a whole criteria string
- MUST fetch all records with `[ID != 0]` when no filter applies
- MUST return an empty collection when nothing matches

#### Scenario: Single equality filter

- GIVEN form `Package` and filter param `{Tracking_Number: trackingVar}`
- WHEN the fetch helper runs
- THEN native `Package[Tracking_Number == trackingVar] sort by Created_Time desc` executes
- AND only matching records return

#### Scenario: Fetch all with no filters

- GIVEN a helper called with no filter params
- WHEN it runs
- THEN it fetches with `[ID != 0]`
- AND all records within the range limit return

### Requirement: Filter by ID List (AND Combinations)

For 2+ active conditions, the system MUST resolve matching IDs per condition and combine them before the final fetch.

- MUST collect IDs per condition via `Form[Field == value].ID.getAll()`
- MUST seed `targetIDs` from the first condition's list (`addAll`) and intersect subsequent lists (`targetIDs = targetIDs.intersect(ids)`)
- MUST perform the final fetch with `Form[ID in targetIDs]` plus the required sort/range
- MUST use `Form[ID != 0]` when no condition applies

#### Scenario: Single-condition ID path

- GIVEN one filter `{Country: countryVar}` in `tool_coverage`
- WHEN the tool runs
- THEN `Coverage_Location[Country == countryVar].ID.getAll()` seeds `targetIDs`
- AND the final fetch is `Coverage_Location[ID in targetIDs] sort by Country range from 0 to 199`

#### Scenario: AND combination

- GIVEN country and vendor filters in `tool_coverage`
- WHEN the tool runs
- THEN `targetIDs = targetIDs.intersect(vendorIDs)`
- AND the final fetch returns only records matching BOTH conditions

#### Scenario: No filters

- GIVEN no filter params
- WHEN the tool runs
- THEN `Coverage_Location[ID != 0]` executes
- AND all records within sort/range return

### Requirement: Native Insert Wrapper

The system MUST provide an insert helper that creates records via `insert into Form[...]` and returns the new record's numeric ID.

#### Scenario: Insert returns new record ID

- GIVEN a new session record map
- WHEN the insert helper runs
- THEN `insert into ChatSessions[...]` executes
- AND the returned value is the numeric ID of the new record

### Requirement: Record Mutation (Native Update)

The system MUST update records by mutating the fetched record in memory; it MUST NOT use `zoho.creator.updateRecord`.

- MUST mutate the record object returned by a native fetch
- MUST NOT mutate a fresh Map (not bound to the record)

#### Scenario: Mutate fetched session record

- GIVEN a session record fetched natively
- WHEN the flow sets `session.Title` and `session.Last_Activity`
- THEN the changes persist with no API call

### Requirement: Native Insert Skips Form Validations

The system MUST NOT depend on `insert into` executing the target form's On Validate / On Success scripts; deployment MUST include a manual UI verification gate in Creator before publish.

#### Scenario: Validations do not run

- GIVEN a form with On Validate / On Success scripts
- WHEN `insert into` creates a record
- THEN those scripts do not execute
- AND the change is gated on manual UI verification in Creator before publish
