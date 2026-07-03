## ADDED Requirements

### Requirement: Sectional dashboard refresh rendering
The dashboard SHALL preserve unchanged DOM sections during periodic refreshes instead of replacing the full application root.

#### Scenario: Application shell remains stable
- **WHEN** the dashboard has completed its initial render
- **AND** a refresh changes only dashboard data
- **THEN** the dashboard SHALL NOT replace the full application root or static shell container
- **AND** it SHALL update only named section containers whose fingerprints changed

#### Scenario: Status-only refresh updates status sections
- **WHEN** periodic refresh returns changed daemon, workload, accelerator, or selected-codebase status
- **THEN** the dashboard SHALL update the status, operations, and telemetry sections whose data changed
- **AND** it SHALL NOT replace unchanged search result, operator log, path, or diagnostics DOM sections

#### Scenario: Selectable text is isolated from volatile controls
- **WHEN** a selectable area contains path text, search result snippets, operator log entries, or diagnostics
- **THEN** that selectable area SHALL have a DOM replacement boundary independent from buttons, disabled states, busy indicators, and polling-only metadata
- **AND** a change to those controls SHALL NOT replace unchanged selectable text nodes

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
