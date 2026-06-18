## ADDED Requirements

### Requirement: Client-Local Action Log
The dashboard SHALL maintain a recent client-local log of operator actions.

#### Scenario: Operation succeeds
- **WHEN** an operator refreshes status, starts indexing, cancels indexing, clears an index, or runs search successfully
- **THEN** the dashboard SHALL append an action log entry with timestamp, action type, target path when applicable, success status, and duration when available.

#### Scenario: Operation fails
- **WHEN** a dashboard API request fails
- **THEN** the dashboard SHALL append an action log entry with timestamp, action type, target path when applicable, failure status, and sanitized error message.

#### Scenario: Log reaches capacity
- **WHEN** the action log exceeds its configured maximum entry count
- **THEN** the dashboard SHALL discard oldest entries first.

### Requirement: Secret-Safe Logging
The dashboard action log SHALL NOT store or display secret-bearing values.

#### Scenario: Authorization data exists
- **WHEN** requests use bearer authorization or dashboard session cookies
- **THEN** the action log SHALL NOT include tokens, cookies, authorization headers, provider API keys, Milvus tokens, or raw environment variable dumps.

#### Scenario: Error message includes sensitive-looking fields
- **WHEN** an error message includes a known secret-bearing key name
- **THEN** the dashboard SHALL redact that value before display or diagnostics export.

### Requirement: Diagnostics Export
The dashboard SHALL provide a sanitized diagnostics copy action.

#### Scenario: Operator copies diagnostics
- **WHEN** the operator triggers diagnostics copy
- **THEN** the dashboard SHALL copy a JSON payload containing sanitized daemon summary, selected codebase path/status, and recent action log entries.

#### Scenario: Clipboard write fails
- **WHEN** browser clipboard write is unavailable or fails
- **THEN** the dashboard SHALL show an error state without losing the current action log.
