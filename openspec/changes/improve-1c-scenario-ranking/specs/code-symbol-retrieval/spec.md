## ADDED Requirements

### Requirement: 1C scenario intent influences ranking without evaluation labels
The system SHALL use bounded, generic 1C scenario-intent signals to rank concrete workflow files above broad neighboring files when candidate evidence supports the query.

#### Scenario: Concrete object-kind intent can outrank broad subsystem modules
- **WHEN** a query contains concrete 1C object-kind intent such as form, common form, document, report, constant, command, document journal, manager module, or object module
- **AND** candidate results include both a broad common module and a file whose path, metadata object name, code text, semantic score, lexical score, exact-symbol evidence, or provider evidence supports that object-kind intent
- **THEN** the concrete object-kind candidate SHALL receive bounded ranking support
- **AND** the broad common module SHALL NOT outrank the concrete candidate solely because it contains more generic subsystem terms

#### Scenario: Directional workflow terms influence matching forms and documents
- **WHEN** a query contains directional workflow terms such as inbound, outgoing, incoming, исходящий, входящий, EDI, ЭДО, email, электронная почта, MCHD, МЧД, FNS, ФНС, SMS, or archive transfer
- **THEN** candidates whose path or content matches the direction and workflow domain SHALL receive bounded ranking support
- **AND** candidates from the same broad subsystem but the wrong direction SHALL NOT outrank the matching directional candidate solely through shared subsystem words

#### Scenario: Generic term dominance is dampened when specific evidence exists
- **WHEN** a query contains generic 1C terms such as обработка, состояние, проверка, подпись, настройка, форма, документ, or письмо together with more specific domain evidence
- **THEN** ranking SHALL prevent the generic terms from dominating more specific matching candidates by themselves
- **AND** exact-symbol, provider-backed, or strongly semantic generic-term matches SHALL remain eligible when they are the best supported candidate

#### Scenario: Broad queries keep broad subsystem results eligible
- **WHEN** a query does not express a concrete object-kind or directional workflow intent
- **THEN** broad common modules, manager modules, service modules, and subsystem modules SHALL remain eligible for top ranking
- **AND** the scenario-intent ranking layer SHALL NOT penalize them solely because they are broad files

### Requirement: Observed large 1C failure classes are covered by generic ranking behavior
The system SHALL include generic ranking behavior and tests for the failure classes found in the first `demo-do30-1c` quality probe.

#### Scenario: FNS response handling can surface the FNS module
- **WHEN** a query mentions FNS response handling with terms such as `NdsResponse`, `ФНС`, and counterparty state
- **THEN** the FNS counterparty-checking module SHALL rank above unrelated queue-processing or generic object-processing modules when its candidate evidence is comparable

#### Scenario: Saved counterparty state can surface server-call counterparty modules
- **WHEN** a query asks where the current saved counterparty state by INN and KPP is stored or loaded
- **THEN** counterparty-checking server-call modules SHALL rank above unrelated counterparty exchange modules when their candidate evidence is comparable

#### Scenario: MCHD constants can surface constant manager modules
- **WHEN** a query asks about a specific MCHD constant such as registry address or signature type
- **THEN** the constant manager module or its exact settings form SHALL rank above generic signature-check result forms when their candidate evidence is comparable

#### Scenario: Inbound and outbound EDI forms can surface viewing forms
- **WHEN** a query asks about manual signature or MCHD checks in inbound or outbound EDI documents
- **THEN** the matching inbound or outbound electronic-document viewing form SHALL remain eligible for top-5 ranking
- **AND** broad MCHD modules SHALL NOT suppress it solely through shared MCHD terminology

#### Scenario: Send assistant form intent can surface the form module
- **WHEN** a query asks about the send assistant UI, its variant tree, or sendability checks
- **THEN** `CommonForms` send-assistant form modules SHALL rank above common helper modules when the query expresses form or UI intent

#### Scenario: Email print and save workflows can surface journal forms
- **WHEN** a query asks about printing or saving email from the email journal
- **THEN** the relevant email journal form SHALL remain eligible for top-5 ranking
- **AND** account setup forms SHALL NOT outrank it solely through shared email terms

#### Scenario: SMS document workflow can distinguish service and document contexts
- **WHEN** a query asks about SMS sending implementation through a provider service
- **THEN** SMS service modules SHALL be allowed as acceptable top results
- **AND** when a query asks about SMS notification document status, limits, or document lifecycle, the SMS notification document manager or form SHALL receive bounded ranking support

#### Scenario: Archive-transfer workflow can distinguish manager and object contexts
- **WHEN** a query asks about archive-transfer print registers, signature checks, or 1C Archive integration
- **THEN** the archive-transfer manager or object module matching that action SHALL receive bounded ranking support
- **AND** generic certificate or storage-object forms SHALL NOT outrank it solely through shared archive or signature words
