# Delta Spec: lookup-tools

Change: **native-data-access** — migrates the 5 business tools (`track_package`, `search_services`, `find_offices`, `check_coverage`, `find_contacts`) to native Creator filters with limits and sorts preserved. This domain is new (no prior formal spec), so all requirements are ADDED.

## ADDED Requirements

### Requirement: Backwards-Compatible Signatures

Each tool MUST return `{"ok": true, "data": <map|list>}` on success and `{"ok": false, "message": <text>}` on failure, identical to today.

#### Scenario: Success shape

- GIVEN a tool finds records
- WHEN the tool returns
- THEN ok:true with data

#### Scenario: Failure shape

- GIVEN a tool finds nothing or lacks a required param
- WHEN the tool returns
- THEN ok:false with message

### Requirement: Native Filter Usage

Tools MUST filter with explicit (literal field, value variable) pairs passed to the fetch helper — never a criteria string variable (`Form[criteriaVar]` is invalid in Creator).

- MUST use inline `Form[Field == valueVar]` for a single active condition
- MUST use the ID-list pattern (`.ID.getAll()` + `intersect` + `Form[ID in targetIDs]`) for 2+ active conditions
- MUST fetch with `[ID != 0]` when no filter applies

#### Scenario: No filters fetch all

- GIVEN `tool_services({})`
- WHEN the tool fetches with no filters
- THEN `[ID != 0]` executes
- AND all services within the limit return

#### Scenario: Single equality filter

- GIVEN `tool_services` with a serviceType param
- WHEN the tool fetches
- THEN inline `Service[Type == serviceTypeVar]` executes (field literal, value variable)

#### Scenario: AND combination in coverage

- GIVEN `tool_coverage` with country and vendor params
- WHEN the tool runs
- THEN IDs combine via `targetIDs.intersect(vendorIDs)`
- AND the final fetch is `Coverage_Location[ID in targetIDs]`

### Requirement: Track Package (Single Record)

`tool_track_package` MUST fetch `Package[Tracking_Number == trackingVar] sort by Created_Time desc`, take the first record via `.get(0)`, and return a single map {trackingNumber, status, origin, destination, currentLocation, estimatedDelivery}.

- MUST return ok:false "Falta el número de seguimiento." when trackingNumber is missing
- MUST return ok:false "No se encontró un paquete..." when the collection is empty

#### Scenario: Package found

- GIVEN a Package with Tracking_Number TRK123
- WHEN the tool runs with that number
- THEN the newest match returns as a single map with ok:true

#### Scenario: Package not found

- GIVEN no Package matches
- WHEN the tool fetches
- THEN `.size() == 0` yields ok:false with the not-found message

### Requirement: List Tools Preserve Limits and Sorts

The 4 list tools MUST preserve today's limits and sort fields:

- `tool_services`: native range 0–199 (200), sort `Service_Name` asc
- `tool_offices`: native range 0–199 (200), sort `Office_Name` asc
- `tool_coverage`: native range 0–199 (200), sort `Country` asc
- `tool_contacts`: native range 0–49 (50), sort `Full_Name` asc

#### Scenario: Limits preserved

- GIVEN a form with more records than the tool's limit
- WHEN the tool fetches with its native range
- THEN at most 200 (or 50 for contacts) records return

#### Scenario: Sort preserved

- GIVEN records in arbitrary insertion order
- WHEN a list tool fetches with its sort field
- THEN data returns sorted by the same field as today
