# Data Access Layer Specification

## Purpose

Central native Zoho Creator access module (`deluge/core/data_access.deluge`) shared by all chat flows and tools. Replaces every `zoho.creator.*` Developer API call with native `fetch Form[criteria]`, `insert into Form[...]`, and in-memory record mutation — 0 external + 0 Developer API calls.

## Requirements

### Requirement: Native Fetch Wrapper

The system MUST provide a fetch helper that reads records from a Creator form using native `Form[criteria]` syntax and returns a COLLECTION.

- MUST accept the form link name, criteria string, sort field with direction, and range
- MUST treat blank criteria as `[ID != 0]` (fetch all)
- MUST return an empty collection when nothing matches

#### Scenario: Fetch with filters

- GIVEN form `Package` and criteria `Tracking_Number == 'TRK123'`
- WHEN the fetch helper runs
- THEN native `Package[Tracking_Number == 'TRK123']` executes
- AND only matching records are returned

#### Scenario: Fetch all with blank criteria

- GIVEN a tool produced criteria ""
- WHEN the fetch helper receives ""
- THEN it fetches with `[ID != 0]`
- AND all records within the range limit are returned

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

### Requirement: Native Criteria Builder

The system MUST provide `append_criteria` emitting native syntax without double quotes around field names (`Field == 'value'`), joined with `and`.

- MUST return the non-empty side when one side is blank
- MUST be the single shared builder used by all 5 tools

#### Scenario: Clauses joined without quotes

- GIVEN base `City == 'Lima'` and clause `Country == 'Peru'`
- WHEN `append_criteria` joins them
- THEN the result is `City == 'Lima' and Country == 'Peru'`

#### Scenario: Blank clause passthrough

- GIVEN a tool with no filters passes ""
- WHEN `append_criteria` is called
- THEN the other side is returned unchanged

### Requirement: Native Insert Skips Form Validations

The system MUST NOT depend on `insert into` executing the target form's On Validate / On Success scripts; deployment MUST include a manual UI verification gate in Creator before publish.

#### Scenario: Validations do not run

- GIVEN a form with On Validate / On Success scripts
- WHEN `insert into` creates a record
- THEN those scripts do not execute
- AND the change is gated on manual UI verification in Creator before publish
