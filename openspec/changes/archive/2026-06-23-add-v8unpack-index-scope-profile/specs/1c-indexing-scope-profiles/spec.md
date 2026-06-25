## ADDED Requirements

### Requirement: Explicit v8unpack 1C indexing scope profile
The system SHALL support `v8unpack` as an explicit 1C indexing scope profile for exported 1C configuration trees produced by `v8unpack`.

#### Scenario: MCP indexing accepts v8unpack scope profile
- **WHEN** a caller invokes `index_codebase` with `oneCIndexScopeProfile` set to `v8unpack`
- **THEN** the tool SHALL validate the value as supported
- **AND** indexing SHALL persist `v8unpack` as the codebase 1C scope profile

#### Scenario: Existing scope profiles remain unchanged
- **WHEN** a caller invokes `index_codebase` with `oneCIndexScopeProfile` set to `full`, `developer`, or `minimal`
- **THEN** the existing Designer/EDT export file-selection behavior SHALL remain unchanged

### Requirement: v8unpack profile selects useful source and metadata files
The `v8unpack` 1C indexing scope profile SHALL select BSL modules and useful JSON metadata/form files from `v8unpack` export trees.

#### Scenario: v8unpack BSL module paths are selected
- **WHEN** pre-index traversal runs with the `v8unpack` profile on files such as `CommonModule/Обмен/CommonModule.obj.bsl`, `Document/Реализация/Document.obj.bsl`, `Document/Реализация/Document.mgr.bsl`, and `DataProcessor/Настройка/Form/Форма/Form.obj.bsl`
- **THEN** those files SHALL be selected for indexing

#### Scenario: v8unpack JSON metadata and form files are selected
- **WHEN** pre-index traversal runs with the `v8unpack` profile on files such as `Document/Реализация/Document.json`, `Document/Реализация/Document.id.json`, `DataProcessor/Настройка/Form/Форма/Form.json`, and `DataProcessor/Настройка/Form/Форма/Form.elem.json`
- **THEN** those files SHALL be selected for indexing

#### Scenario: v8unpack profile includes JSON without manual custom extension
- **WHEN** indexing starts with `oneCIndexScopeProfile` set to `v8unpack`
- **AND** the caller does not provide `.json` in `customExtensions`
- **THEN** JSON files eligible under the `v8unpack` profile SHALL still be considered supported for that codebase session
- **AND** the same effective extension set SHALL be used by pre-index traversal and synchronizer snapshot generation

### Requirement: v8unpack profile excludes heavy generated resources
The `v8unpack` 1C indexing scope profile SHALL exclude heavy generated or binary resources.

#### Scenario: Heavy v8unpack resources are excluded
- **WHEN** pre-index traversal runs with the `v8unpack` profile on files ending with `.mxl`, `.bin`, `.c1b64`, `.c1brace`, `.png`, `.jpg`, `.jpeg`, `.gif`, or `.svg`
- **THEN** those files SHALL NOT be selected by the profile

#### Scenario: Full profile remains available for arbitrary explicit extensions
- **WHEN** a caller needs to index heavy `v8unpack` resources through `customExtensions`
- **THEN** the caller SHALL be able to use the existing `full` profile and explicit ignore patterns
- **AND** the `v8unpack` profile SHALL NOT need to include those heavy resources

### Requirement: v8unpack profile remains a file-selection feature only
The `v8unpack` 1C indexing scope profile SHALL NOT alter retrieval scoring, ranking profile behavior, embedding provider behavior, vector schema, or search response schema.

#### Scenario: v8unpack index uses existing retrieval and storage paths
- **WHEN** a codebase is indexed with `oneCIndexScopeProfile` set to `v8unpack`
- **THEN** splitting, embedding, vector insertion, and search SHALL use the same retrieval/storage path selected by the existing retrieval profile and embedding configuration
- **AND** no collection migration SHALL be required solely because the scope profile is `v8unpack`

#### Scenario: Changing profile still requires force reindex
- **WHEN** an already indexed codebase has a persisted 1C scope profile different from `v8unpack`
- **AND** a caller requests `v8unpack` without force reindexing
- **THEN** indexing SHALL fail with the existing incompatible-profile behavior

### Requirement: v8unpack profile is observable as scoped 1C coverage
The system SHALL expose `v8unpack` profile selection and scoped-coverage warnings through existing 1C scope status fields.

#### Scenario: v8unpack indexing reports scoped coverage
- **WHEN** indexing runs with `oneCIndexScopeProfile` set to `v8unpack`
- **THEN** traversal diagnostics and indexing status SHALL report `oneCIndexScopeProfile` as `v8unpack`
- **AND** status or diagnostics SHALL include a reduced/scoped coverage warning indicating that the profile intentionally excludes some export resources

#### Scenario: v8unpack profile state remains separate from ranking profile
- **WHEN** search runs against a codebase indexed with `oneCIndexScopeProfile` set to `v8unpack`
- **THEN** the response SHALL report the persisted 1C scope profile through existing status/profile fields
- **AND** the response SHALL NOT change or persist the search-time ranking profile because of the indexing scope profile
