## ADDED Requirements

### Requirement: One-C ranking matches compound 1C metadata names without labels
The system SHALL use generic compound-name matching for recognized 1C exported-configuration paths when `rankingProfile=one-c` or equivalent automatic 1C behavior is active.

#### Scenario: Compound form name matches natural-language phrase
- **WHEN** a query contains natural-language terms that correspond to a compound 1C form name such as `ПечатьПисьма`, `ПросмотрВложенногоПисьма`, or `Подписи`
- **AND** candidate results include a recognized 1C form whose path kind, area kind, content, semantic score, lexical score, exact-symbol evidence, or provider evidence independently supports that compound-name intent beyond raw form-name token overlap
- **THEN** the matching form candidate SHALL receive bounded compound-name ranking support
- **AND** unrelated email, EDI, settings, or viewing forms SHALL NOT outrank it solely through shared generic domain words

#### Scenario: Compound constant name matches registry-address intent
- **WHEN** a query contains terms such as `адрес`, `реестр`, `МЧД`, `ФНС`, `константа`, or `менеджер`
- **AND** candidate results include a constant manager module whose compound name and independent evidence from module kind, content, semantic score, lexical score, exact-symbol evidence, or provider evidence support that query
- **THEN** the matching constant manager SHALL receive bounded ranking support
- **AND** unrelated address-list, email-list, or exchange-manager candidates SHALL NOT outrank it solely through generic `адрес` or `менеджер` terms

#### Scenario: Compound module name matches counterparty state intent
- **WHEN** a query asks about saved counterparty state by INN and KPP
- **AND** candidate results include a counterparty-checking client/server or server-call module whose compound name and independent content, semantic, lexical, exact-symbol, or provider evidence support that intent
- **THEN** the matching counterparty-checking module SHALL receive bounded ranking support
- **AND** unrelated counterparty overview, requisites-fill, dossier, or EDI state candidates SHALL NOT outrank it solely through shared `контрагент`, `состояние`, `ИНН`, or `КПП` terms

#### Scenario: Object-module and manager-module terms are distinguished
- **WHEN** a query names a 1C document and asks for its object module or manager module behavior
- **THEN** candidates whose module kind matches the requested module kind and whose document name or content supports the requested workflow SHALL receive bounded support
- **AND** the opposite module kind SHALL NOT outrank the matching module solely because it shares the same document object name

### Requirement: Compound-name ranking resists overfitting
The system SHALL keep compound-name ranking generic, bounded, and independent from evaluation datasets.

#### Scenario: Production ranking does not inspect evaluation labels
- **WHEN** production `search_code` ranks any result
- **THEN** it SHALL NOT inspect scenario IDs, holdout IDs, expected path prefixes, acceptable path prefixes, failure classes, notes, or dataset files
- **AND** compound-name support SHALL be derived from query text and candidate evidence only

#### Scenario: Fixture identity does not select compound-name weights
- **WHEN** production `search_code` ranks results with `rankingProfile=one-c`
- **THEN** it SHALL NOT choose compound-name weights or routing based on fixture names such as `demo-do30-1c`, `demo-bp30-1c`, `demo-ut-1c`, `demo-unf-1c`, or `demo-zup-1c`
- **AND** compound-name ranking SHALL remain based on query text, 1C path shape, metadata kind, module kind, content, lexical evidence, semantic evidence, exact-symbol evidence, provider evidence, and diagnostics

#### Scenario: Broad conceptual queries keep subsystem results eligible
- **WHEN** a query contains broad subsystem terms without concrete object, form, constant, command, manager-module, object-module, or compound-name intent
- **THEN** broad common modules, manager modules, service modules, and subsystem modules SHALL remain eligible for top ranking
- **AND** compound-name support SHALL NOT penalize them solely because they are broad files

#### Scenario: Negative controls prevent exact-looking false positives
- **WHEN** a query asks for a generic email, EDI, MCHD, archive, counterparty, state, settings, signature, or document concept
- **AND** a candidate has an exact-looking compound name but lacks supporting query and candidate evidence for the requested workflow
- **THEN** that candidate SHALL NOT receive enough compound-name support to outrank better-supported broad or semantic candidates
- **AND** exact-symbol and provider-backed candidates SHALL remain protected when they are genuinely requested

#### Scenario: Diagnostics expose compound-name evidence
- **WHEN** compound-name support changes a result score
- **THEN** result metadata SHALL expose a compact diagnostic score or reason for the compound-name component
- **AND** diagnostics SHALL NOT include dense, sparse, or ColBERT vector payloads
