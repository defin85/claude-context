## ADDED Requirements

### Requirement: Sectional dashboard refresh rendering
The dashboard SHALL preserve unchanged DOM sections during periodic refreshes instead of replacing the full application root.

#### Scenario: Status-only refresh updates status sections
- **WHEN** periodic refresh returns changed daemon, workload, accelerator, or selected-codebase status
- **THEN** the dashboard SHALL update the status, operations, and telemetry sections whose data changed
- **AND** it SHALL NOT replace unchanged search result, operator log, path, or diagnostics DOM sections

#### Scenario: Unchanged selectable content keeps text selection
- **WHEN** an operator has selected text inside an unchanged search result, operator log, path, or diagnostics section
- **AND** periodic refresh changes only other dashboard sections
- **THEN** the browser text selection SHALL remain in the unchanged section after the refresh

#### Scenario: Changed selectable content may be replaced
- **WHEN** a refresh or user action changes the content of a selectable section
- **THEN** the dashboard MAY replace that section's DOM
- **AND** it SHALL keep other unchanged sections stable

#### Scenario: Input focus remains supported
- **WHEN** a refresh updates dashboard sections while an operator is editing a dashboard input
- **THEN** the dashboard SHALL preserve the existing input focus and caret or selection range where the input remains present
