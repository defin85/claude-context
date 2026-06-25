# one-c-search-runbook Specification

## Purpose
TBD - created by archiving change add-1c-search-runbook. Update Purpose after archive.
## Requirements
### Requirement: 1C search runbook guides agent query decomposition
The system SHALL provide an agent-facing runbook for using semantic search in exported 1C repositories without relying on a separate LLM planner.

#### Scenario: Runbook starts with the user's task
- **WHEN** an agent needs to search a 1C repository for an implementation task
- **THEN** the runbook SHALL instruct the agent to first search the user's natural-language task
- **AND** it SHALL instruct the agent to treat that result as exploration, not as the full context bundle

#### Scenario: Runbook expands to 1C and library terms
- **WHEN** the first search reveals or implies 1C, BSP, BED, or platform terms
- **THEN** the runbook SHALL instruct the agent to issue focused searches using those module names, method names, metadata names, or domain terms
- **AND** the runbook SHALL include guidance for inferred terms that the user did not explicitly provide

#### Scenario: Runbook collects context by role
- **WHEN** the agent prepares context for an LLM-assisted 1C implementation
- **THEN** the runbook SHALL instruct the agent to collect results by role, including API entry points, client-side calls, server-side calls, applied examples, and related metadata where relevant
- **AND** it SHALL instruct the agent not to stop at the first individually relevant result when the task needs multiple roles

#### Scenario: Runbook preserves the RLM boundary
- **WHEN** the runbook mentions RLM-assisted exploration
- **THEN** it SHALL state that RLM is a follow-up inspection tool after semantic search, not an indexing or production-search enrichment path

### Requirement: Runbook includes a concrete long-running operations example
The 1C search runbook SHALL include a concise example for finding implementation context for BSP long-running operations.

#### Scenario: Long-running operations example uses multiple searches
- **WHEN** the runbook demonstrates long-running operations
- **THEN** it SHALL include separate search examples for the natural task, BSP server API, client waiting/progress handling, server completion checks, and applied form usage
- **AND** the example SHALL name representative terms such as `ДлительныеОперации`, `ВыполнитьВФоне`, `ПараметрыВыполненияВФоне`, `ДлительныеОперацииКлиент`, `ОжидатьЗавершение`, and `ПараметрыОжидания`

#### Scenario: Long-running operations example explains useful output
- **WHEN** the long-running operations example is read
- **THEN** it SHALL explain that a useful context bundle includes BSP API modules and applied usage examples from the target configuration
- **AND** it SHALL warn that a single broad semantic query can return partial or noisy context

