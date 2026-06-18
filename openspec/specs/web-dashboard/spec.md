# web-dashboard Specification

## Purpose
TBD - created by archiving change add-web-dashboard. Update Purpose after archive.
## Requirements
### Requirement: Local Dashboard Server
The system SHALL provide an opt-in local web dashboard server for daemon mode without changing the existing MCP endpoint behavior.

#### Scenario: Dashboard disabled by default
- **WHEN** the daemon starts without dashboard enablement
- **THEN** the system SHALL NOT expose the dashboard routes

#### Scenario: Dashboard enabled locally
- **WHEN** the daemon starts with dashboard enablement configured
- **THEN** the system SHALL serve the dashboard on the configured local host and port

#### Scenario: MCP endpoint remains compatible
- **WHEN** the dashboard server is enabled
- **THEN** existing MCP clients SHALL continue using the configured MCP endpoint without request or response shape changes

### Requirement: Dashboard Authentication and Secret Handling
The system SHALL protect dashboard API routes with daemon-compatible local authentication and SHALL NOT disclose secret-bearing configuration values.

#### Scenario: API request without authorization
- **WHEN** a browser or API client requests a protected dashboard API route without valid authorization
- **THEN** the system SHALL return an authorization error and SHALL NOT execute the requested operation

#### Scenario: Status payload hides secrets
- **WHEN** the dashboard displays daemon configuration or runtime status
- **THEN** the payload SHALL exclude bearer tokens, embedding provider API keys, Milvus tokens, and raw environment variable dumps

#### Scenario: Static assets do not embed secrets
- **WHEN** the dashboard serves HTML, JavaScript, CSS, or other static assets
- **THEN** those assets SHALL NOT contain daemon bearer tokens or provider credentials

### Requirement: Codebase Overview and Selection
The dashboard SHALL show known codebases and allow users to select a codebase path that is permitted by the daemon access policy.

#### Scenario: Known codebases are displayed
- **WHEN** the dashboard loads
- **THEN** it SHALL display codebases known from daemon snapshots, persisted codebase config, or active workload status

#### Scenario: Allowed path is accepted
- **WHEN** a user enters an absolute path under an allowed root
- **THEN** the dashboard API SHALL accept the path and return status for that codebase

#### Scenario: Disallowed path is rejected
- **WHEN** a user enters a path outside daemon allowed roots
- **THEN** the dashboard API SHALL reject the request using the same access policy as MCP tools

### Requirement: Indexing Operations
The dashboard SHALL allow users to start indexing, clear an index, cancel active indexing, and refresh status for an allowed codebase.

#### Scenario: Start indexing
- **WHEN** a user starts indexing for an allowed codebase with optional custom extensions or ignore patterns
- **THEN** the system SHALL invoke the existing indexing behavior and return the resulting workload or indexing status

#### Scenario: Cancel indexing
- **WHEN** a user cancels active indexing for a codebase
- **THEN** the system SHALL cancel the matching daemon workload and report queued and active jobs affected

#### Scenario: Clear index
- **WHEN** a user clears an index for an allowed codebase
- **THEN** the system SHALL invoke the existing clear-index behavior and report success or the active-workload conflict

#### Scenario: Refresh status
- **WHEN** a user refreshes a selected codebase
- **THEN** the dashboard SHALL show the latest `get_indexing_status` result for that path

### Requirement: Runtime and Accelerator Observability
The dashboard SHALL expose daemon, workload, accelerator, worker, retrieval, and pre-index telemetry needed to understand indexing performance.

#### Scenario: Runtime status summary
- **WHEN** the dashboard loads
- **THEN** it SHALL show daemon liveness, runtime mode, endpoint information without secrets, allowed roots, and workload queues

#### Scenario: Active indexing metrics
- **WHEN** a codebase is indexing
- **THEN** the dashboard SHALL show progress percentage, current and total file counts, current phase, submitted batches, completed batches, failed batches, retried batches, queued batches, running embedding batches, running insert batches, active workers, rejected workers, backpressure wait time, embedding time, insert time, and pre-index file counts when available

#### Scenario: Worker planning metrics
- **WHEN** managed BGE-M3 worker planning is available
- **THEN** the dashboard SHALL show planned and running worker counts, fallback reason, stop reason, VRAM budget, VRAM estimate source, and worker endpoint health without exposing secrets

#### Scenario: Retrieval mode is visible
- **WHEN** a codebase status includes retrieval configuration
- **THEN** the dashboard SHALL distinguish dense-only BGE-M3, full BGE-M3 dense+sparse+ColBERT, hybrid dense+BM25 sparse, and other configured retrieval modes

### Requirement: Search Workflow
The dashboard SHALL provide a search view over indexed codebases using the existing `search_code` behavior.

#### Scenario: Successful search
- **WHEN** a user submits a query for an indexed codebase
- **THEN** the dashboard SHALL display matching results with relative path, line range, language when available, score, and content snippet

#### Scenario: Extension-filtered search
- **WHEN** a user provides extension filters
- **THEN** the dashboard SHALL pass those filters to the existing search behavior and display only matching results returned by the server

#### Scenario: Search unavailable for unindexed codebase
- **WHEN** a user searches a codebase that has no usable index
- **THEN** the dashboard SHALL show the server error or not-indexed state without starting an implicit indexing job

### Requirement: UI Refresh and Failure States
The dashboard SHALL keep operator-facing status fresh and present daemon failures without hiding partial data.

#### Scenario: Periodic refresh
- **WHEN** the dashboard is open on a status page
- **THEN** it SHALL periodically refresh daemon and selected-codebase status while avoiding overlapping refresh requests

#### Scenario: Daemon unreachable
- **WHEN** the dashboard API cannot reach the daemon runtime or its internal handlers fail
- **THEN** the UI SHALL show an unreachable or failed state with the last successful status snapshot if one exists

#### Scenario: Long-running operation remains visible
- **WHEN** indexing continues after the initial start request returns
- **THEN** the dashboard SHALL keep showing the background workload status until completion, cancellation, or failure

### Requirement: Dashboard Documentation
The system SHALL document how to enable, operate, secure, and troubleshoot the web dashboard.

#### Scenario: Operator reads setup documentation
- **WHEN** a user opens dashboard documentation
- **THEN** the documentation SHALL include enablement flags or environment variables, local URL, authentication model, supported operations, and security warnings

#### Scenario: Developer reads verification documentation
- **WHEN** a contributor reads dashboard development documentation
- **THEN** it SHALL include build, typecheck, API test, UI test, and manual smoke-check commands

