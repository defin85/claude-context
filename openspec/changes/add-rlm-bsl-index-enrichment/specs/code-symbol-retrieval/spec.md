## ADDED Requirements

### Requirement: Hybrid retrieval uses stored RLM BSL enrichment metadata
The system SHALL use stored RLM BSL enrichment metadata as a code-symbol ranking signal when the indexed collection contains that metadata.

#### Scenario: Stored RLM symbol metadata boosts matching chunks
- **WHEN** a search query matches a method, procedure, object, module, form, command, or synonym stored in `metadata.bsl`
- **THEN** matching chunks SHALL receive bounded structural ranking support from the stored enrichment metadata
- **AND** the result diagnostics SHALL identify stored RLM enrichment as a retrieval or ranking source

#### Scenario: Stored enrichment is preferred over search-time RLM provider
- **WHEN** the current indexed collection contains compatible RLM BSL enrichment metadata
- **THEN** ranking SHALL use the stored enrichment fields without requiring a search-time `rlm-tools-bsl` subprocess query
- **AND** the search-time RLM provider SHALL remain available only as fallback behavior for unenriched indexes or explicitly configured experimental runs

#### Scenario: Enrichment metadata does not replace semantic retrieval
- **WHEN** stored RLM BSL enrichment metadata is present
- **THEN** search SHALL still include semantic BGE-M3 results and existing lexical candidates
- **AND** enrichment-derived boosts SHALL remain bounded ranking signals rather than hard filters

### Requirement: Search remains backward-compatible for unenriched indexes
The system SHALL preserve current hybrid retrieval behavior for indexes that do not contain RLM BSL enrichment metadata.

#### Scenario: Existing collection without RLM enrichment remains searchable
- **WHEN** searching a collection indexed before RLM BSL enrichment was added
- **THEN** search SHALL continue using semantic retrieval, no-reindex lexical fallback, path/module boosts, and configured search-time providers as before
- **AND** missing stored enrichment SHALL NOT be treated as a search failure

#### Scenario: Diagnostics distinguish stored enrichment from provider candidates
- **WHEN** a search result is influenced by stored RLM BSL enrichment metadata
- **THEN** result metadata SHALL distinguish that source from search-time provider candidates
- **AND** diagnostics SHALL NOT claim that a live `rlm-tools-bsl` provider contributed unless it was actually queried for that search

### Requirement: RLM-enriched ranking is evaluated without production label leakage
The system SHALL validate RLM-enriched ranking through the 1C relevance evaluation while keeping evaluation labels out of production ranking.

#### Scenario: Evaluation reports enriched versus baseline quality
- **WHEN** a 1C relevance evaluation runs against an RLM-enriched index
- **THEN** the report SHALL include enrichment status and quality metrics such as Hit@1, Hit@3, Hit@5, Hit@10, MRR@10, Precision@k, per-query first relevant rank, top paths, latency, and failures
- **AND** it SHALL compare the enriched run against the selected non-enriched baseline

#### Scenario: Production ranking ignores evaluation expected paths
- **WHEN** stored RLM enrichment fields are used by production search
- **THEN** production ranking SHALL use only query text, indexed content, paths, vector scores, lexical scores, and stored enrichment metadata
- **AND** it SHALL NOT read evaluation query IDs, expected path prefixes, or fixture labels to route, filter, boost, or rank results
