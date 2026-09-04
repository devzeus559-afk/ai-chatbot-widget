# Delta Spec: data-access-layer

Change: **report-top-customers** — adds date-window Service helpers to the native access module for the top-customers report. Existing helpers and behavior are unchanged; all new requirements are ADDED.

## ADDED Requirements

### Requirement: Date-Window Service Count

The system MUST provide a helper counting Service records whose `Date_field1` lies within a given date range, using literal field names and variable values (gate 5.1).

#### Scenario: Count within window

- GIVEN start and end dates
- WHEN the count helper runs
- THEN `Service[Date_field1 >= startDate && Date_field1 <= endDate].count(ID)` returns the count

### Requirement: Date-Window Service Fetch

The system MUST provide a helper fetching Service records within a date range with a range limit.

- MUST fetch with `Date_field1 >= startDate && Date_field1 <= endDate` (literal field, variable values)
- MUST cap each fetch at 200 records (`range 0–199`)
- MUST return an empty collection when nothing matches

#### Scenario: Window under cap

- GIVEN a window with 150 services
- WHEN the fetch helper runs
- THEN the 150 records return in one fetch

#### Scenario: Window over cap

- GIVEN a window with 250 services
- WHEN the fetch helper runs
- THEN 200 records return (truncation is flagged by the tool via the count helper)

### Requirement: Date-Window Service IDs

The system MUST provide a helper returning Service IDs within a date range so the tool can intersect them with type-filter IDs when `serviceType` is present.

#### Scenario: IDs combined with type filter

- GIVEN a date window and `serviceType`
- WHEN the tool intersects window IDs with `fetch_services_ids_by_type`
- THEN the final fetch is `Service[ID in targetIDs]` with only matching services
