## ADDED Requirements

### Requirement: 1C Scope Profiles
The system SHALL support explicit 1C indexing scope profiles for recognized exported 1C configuration trees.

#### Scenario: Full scope is selected
- **WHEN** the 1C scope profile is `full`
- **THEN** traversal SHALL preserve existing include/exclude behavior

#### Scenario: Developer scope is selected
- **WHEN** the 1C scope profile is `developer`
- **THEN** traversal SHALL prioritize BSL modules and developer-relevant metadata while excluding documented low-value generated files

#### Scenario: Minimal scope is selected
- **WHEN** the 1C scope profile is `minimal`
- **THEN** traversal SHALL include only documented high-value BSL/code artifacts needed for fast code search

### Requirement: Scope Filtering Is Explicit And Reported
The system SHALL report selected 1C scope and filtering effects.

#### Scenario: Indexing starts with reduced scope
- **WHEN** indexing starts with a reduced 1C scope profile
- **THEN** logs and structured status SHALL include the selected scope profile

#### Scenario: Files are excluded by scope
- **WHEN** traversal excludes files due to the selected profile
- **THEN** status or summary SHALL include counts by include/exclude reason

### Requirement: Scope Profile Is Persisted
The selected 1C scope profile SHALL be persisted with codebase index metadata.

#### Scenario: Reduced scope index is searched
- **WHEN** search runs against a codebase indexed with reduced 1C scope
- **THEN** status SHALL expose that the index is intentionally scoped and may not contain all files

#### Scenario: Scope changes without force
- **WHEN** indexing is requested with a scope profile incompatible with the persisted profile and `force` is not true
- **THEN** the system SHALL reject the operation and report that force reindex is required

### Requirement: Non-1C Codebases Are Not Affected
1C scope profiles SHALL only apply to recognized 1C exported configuration trees or explicit 1C scope configuration.

#### Scenario: Non-1C repository is indexed
- **WHEN** a non-1C repository is indexed without explicit 1C scope selection
- **THEN** traversal SHALL behave as it did before this change

#### Scenario: 1C layout is not recognized
- **WHEN** a codebase does not match recognized 1C export path conventions
- **THEN** reduced 1C scope SHALL fail clearly or remain inactive according to documented configuration behavior

## MODIFIED Requirements

### Requirement: Preindex traversal filtering
The system SHALL apply configured traversal filters before splitting and embedding files.

#### Scenario: 1C scope profile excludes a file
- **WHEN** a recognized 1C file is excluded by the active scope profile
- **THEN** the file SHALL not be split, embedded, or counted as indexed content, and the exclusion SHALL be visible in traversal statistics
