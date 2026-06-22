## ADDED Requirements

### Requirement: MCP search guidance exposes 1C context-bundle workflow
The MCP `search_code` tool SHALL include agent-facing guidance for exported 1C configurations that presents non-trivial 1C implementation tasks as context-bundle searches rather than single-result lookups.

#### Scenario: Search-code description includes generic 1C workflow guidance
- **WHEN** MCP clients discover the `search_code` tool
- **THEN** the tool description SHALL tell agents that non-trivial 1C tasks often require a context bundle
- **AND** it SHALL recommend starting with the user task as written and then using focused searches for library API, client usage, server usage, applied usage, and metadata/state roles

#### Scenario: Guidance stays independent from ranking behavior
- **WHEN** the 1C guidance is presented for `search_code`
- **THEN** it SHALL state or imply guidance for agent search strategy only
- **AND** it SHALL NOT change `rankingProfile` behavior, retrieval scoring, provider behavior, or indexed collection requirements

### Requirement: MCP search guidance avoids scenario-label leakage
The MCP 1C search guidance SHALL remain generic and SHALL NOT expose evaluation-specific labels, query IDs, expected path prefixes, or fixture answers as production instructions.

#### Scenario: Tool guidance excludes evaluation labels
- **WHEN** MCP clients discover the `search_code` tool
- **THEN** the tool description SHALL NOT include scenario matrix IDs, expected result path prefixes, query labels, or hard-coded fixture answers
- **AND** it SHALL NOT instruct production search to route, filter, boost, or rank using evaluation labels

#### Scenario: Documentation distinguishes runbook guidance from eval truth
- **WHEN** MCP documentation links to the 1C semantic search runbook
- **THEN** it SHALL describe the runbook as agent search guidance
- **AND** it SHALL keep scenario matrices and expected paths as validation evidence rather than runtime search instructions

### Requirement: MCP search guidance explains 1C metadata coverage limits
The MCP 1C search guidance SHALL warn that some 1C metadata or configuration-state context can be outside the current indexed search coverage and may require checking index scope or filesystem context.

#### Scenario: Missing metadata result directs agent to coverage checks
- **WHEN** an agent needs 1C metadata/state context and `search_code` does not return a plausible metadata target
- **THEN** the guidance SHALL direct the agent to inspect index scope/profile coverage or filesystem context
- **AND** it SHALL NOT require an index migration, rebuild, or new MCP parameter solely to follow the guidance

### Requirement: MCP documentation links the 1C semantic search runbook
MCP-facing documentation for `search_code` SHALL include a pointer to the repo-local 1C semantic search runbook when describing 1C search usage.

#### Scenario: Search-code docs point to the maintained runbook
- **WHEN** a developer reads MCP documentation for `search_code`
- **THEN** the documentation SHALL link or refer to `docs/dive-deep/one-c-semantic-search-runbook.md`
- **AND** it SHALL summarize the context-bundle workflow without duplicating the full runbook
