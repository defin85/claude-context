import './styles.css';
import {
    ActionLogEntry,
    createActionRecorder,
    createDiagnosticsPayload,
    maxActionLogEntries,
    sanitizeError,
} from './actionLog';
import { buildProgressSummary, CodebaseStatus } from './operationsView';
import {
    buildProfileStateSections,
    buildSearchRequestBody,
    DashboardProfileState,
    formatRetrievalContext,
    getResultDiagnostics,
    RankingProfile,
    RetrievalContext,
} from './searchDiagnostics';
import {
    buildWorkerTelemetryView,
    ManagedBgeM3Workers,
    WorkerEndpointHealth,
} from './workerTelemetry';

type ApiSuccess<T> = { ok: true; data: T };
type ApiFailure = { ok: false; error: string; data?: unknown };
type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

interface DaemonStatus {
    discovery?: { endpointUrl?: string; tokenSha256?: string } | null;
    runtimes?: Array<{
        runtimeId: string;
        pid: number;
        healthy: boolean;
        endpointUrl: string;
        knownCodebases?: Array<{ path: string; status: string }>;
        workload?: {
            indexing?: WorkloadLane;
            search?: WorkloadLane;
        };
    }>;
    accelerator?: {
        mode?: string;
        active?: boolean;
        activeWorkers?: number;
        rejectedWorkers?: number;
        workerPool?: WorkerEndpointHealth[];
        workerEndpoints?: WorkerEndpointHealth[];
        workerHealth?: WorkerEndpointHealth[];
        effectiveEmbeddingConcurrency?: number;
        effectiveInsertConcurrency?: number;
        submittedBatches?: number;
        completedBatches?: number;
        failedBatches?: number;
        retriedBatches?: number;
        queuedBatches?: number;
        runningEmbeddingBatches?: number;
        queuedInsertBatches?: number;
        runningInsertBatches?: number;
        completedInsertBatches?: number;
        failedInsertBatches?: number;
        adaptivePressureScore?: number;
        adaptiveThrottleReason?: string;
        fallbackReason?: string;
    };
    managedBgeM3Workers?: ManagedBgeM3Workers | null;
    workerPlanningPolicy?: {
        owner?: string;
        agentDirective?: string;
    };
    retrievalConfiguration?: {
        retrievalProfile?: string;
        retrievalMode?: string;
        retrievalSchemaVersion?: number;
        bgeM3Mode?: string;
        usesBgeM3Sparse?: boolean;
        usesColbert?: boolean;
    };
    profileState?: DashboardProfileState;
}

interface WorkloadJob {
    id: string;
    type: string;
    codebasePath: string;
    priority: number;
    enqueuedAt: string;
    startedAt?: string;
    readyAt?: string;
    cancelRequestedAt?: string;
    queuePosition?: number;
}

interface WorkloadLane {
    maxConcurrency?: number;
    activeCount?: number;
    queuedCount?: number;
    activeJobs?: WorkloadJob[];
    queuedJobs?: WorkloadJob[];
}

interface CodebaseSummary {
    path: string;
    status: string;
}

interface SearchResult {
    relativePath: string;
    language?: string;
    startLine: number;
    endLine: number;
    score: number;
    content: string;
    metadata?: Record<string, unknown>;
}

type DashboardCodebaseStatus = CodebaseStatus & RetrievalContext & { profileState?: DashboardProfileState };

interface SearchData extends RetrievalContext {
    results?: SearchResult[];
    rankingProfile?: RankingProfile;
    indexingStatus?: string;
    oneCIndexScope?: unknown;
    profileState?: DashboardProfileState;
}

const tokenKey = 'claude-context-dashboard-token';
const state = {
    token: sessionStorage.getItem(tokenKey) || '',
    status: undefined as DaemonStatus | undefined,
    selectedStatus: undefined as DashboardCodebaseStatus | undefined,
    codebases: [] as CodebaseSummary[],
    selectedPath: '',
    message: '',
    error: '',
    searchQuery: '',
    extensionFilterText: '',
    rankingProfile: 'auto' as RankingProfile,
    searchResults: [] as SearchResult[],
    searchContext: undefined as SearchData | undefined,
    actionLog: [] as ActionLogEntry[],
    busy: false,
    refreshInFlight: false,
};
let lastRefreshFingerprint = '';
const actionRecorder = createActionRecorder({ entries: state.actionLog, maxEntries: maxActionLogEntries });

const apiBase = `${window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '')}/api`;
const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
    throw new Error('App root not found.');
}
const root = app;

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${apiBase}${path}`, {
        ...options,
        credentials: 'same-origin',
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
            ...options.headers,
        },
    });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        throw new Error('Dashboard API недоступен на текущем адресе. Откройте панель через daemon route или настройте прокси.');
    }
    const payload = await response.json() as ApiResponse<T>;
    if (!payload.ok) {
        throw new Error(payload.error || `Request failed with HTTP ${response.status}`);
    }
    return payload.data;
}

function setToken(value: string): void {
    state.token = value.trim();
    if (state.token) {
        sessionStorage.setItem(tokenKey, state.token);
    } else {
        sessionStorage.removeItem(tokenKey);
    }
}

async function refresh(options: { showBusy?: boolean; showMessage?: boolean; forceRender?: boolean } = {}): Promise<void> {
    const shouldRecord = Boolean(options.showBusy || options.showMessage);
    if (!shouldRecord) {
        await refreshInternal(options);
        return;
    }

    try {
        await actionRecorder.record('refresh', () => refreshInternal(options, true), { targetPath: state.selectedPath || undefined });
    } catch {
        // refreshInternal already rendered the operator-visible error.
    }
}

async function refreshInternal(options: { showBusy?: boolean; showMessage?: boolean; forceRender?: boolean } = {}, rethrowErrors = false): Promise<void> {
    if (state.refreshInFlight) {
        return;
    }

    if (options.showBusy) {
        state.busy = true;
    }
    state.refreshInFlight = true;
    state.error = '';
    if (options.showBusy) {
        render();
    }
    try {
        const [status, codebases] = await Promise.all([
            api<DaemonStatus>('/daemon/status'),
            api<CodebaseSummary[]>('/codebases'),
        ]);
        const selectedPath = state.selectedPath || codebases[0]?.path || '';
        const selectedStatus = selectedPath ? await loadSelectedStatus(selectedPath) : undefined;
        const nextFingerprint = JSON.stringify({ status, codebases, selectedPath, selectedStatus });
        const shouldRender = options.forceRender || nextFingerprint !== lastRefreshFingerprint;

        state.status = status;
        state.codebases = codebases;
        state.selectedPath = selectedPath;
        state.selectedStatus = selectedStatus;
        lastRefreshFingerprint = nextFingerprint;
        if (options.showMessage) {
            state.message = `Обновлено: ${new Date().toLocaleTimeString()}`;
        }
        if (shouldRender || options.showMessage) {
            render();
        }
    } catch (error) {
        state.error = sanitizeError(error);
        if (!rethrowErrors) {
            actionRecorder.recordFailure('refresh', error, { targetPath: state.selectedPath || undefined });
        }
        render();
        if (rethrowErrors) {
            throw error;
        }
    } finally {
        if (options.showBusy) {
            state.busy = false;
        }
        state.refreshInFlight = false;
        if (options.showBusy) {
            render();
        }
    }
}

async function loadSelectedStatus(path: string): Promise<CodebaseStatus | undefined> {
    try {
        return await api<CodebaseStatus>(`/codebases/status?path=${encodeURIComponent(path)}`);
    } catch (error) {
        actionRecorder.recordFailure('refresh', error, { targetPath: path });
        return undefined;
    }
}

async function runAction(action: 'index' | 'clear' | 'cancel', path = state.selectedPath, cancelKind = 'выбранную'): Promise<void> {
    if (!path) {
        state.error = 'Выберите кодовую базу.';
        render();
        return;
    }

    const route = action === 'index'
        ? '/codebases/index'
        : action === 'clear'
            ? '/codebases/clear'
            : '/codebases/cancel';
    if (
        (action === 'clear' && !window.confirm(`Очистить индекс для ${path}?`))
        || (action === 'cancel' && !window.confirm(`Отменить ${cancelKind} индексацию для ${path}?`))
    ) {
        return;
    }

    state.busy = true;
    state.error = '';
    render();
    try {
        await actionRecorder.record(action, () => api(route, {
            method: 'POST',
            body: JSON.stringify({
                path,
                ...(action === 'index' ? { splitter: 'ast' } : {}),
                ...(action === 'cancel' ? { reason: `Cancelled ${cancelKind} indexing from web dashboard.` } : {}),
            }),
        }), { targetPath: path });
        state.message = action === 'index'
            ? 'Индексация поставлена в очередь.'
            : action === 'clear'
                ? 'Индекс очищен.'
                : 'Отмена отправлена.';
        await refresh({ forceRender: true });
    } catch (error) {
        state.error = sanitizeError(error);
    } finally {
        state.busy = false;
        render();
    }
}

async function search(): Promise<void> {
    if (!state.selectedPath || !state.searchQuery.trim()) {
        state.error = 'Выберите кодовую базу и введите запрос.';
        render();
        return;
    }

    state.busy = true;
    state.error = '';
    render();
    try {
        const data = await actionRecorder.record('search', () => api<SearchData>('/search', {
            method: 'POST',
            body: JSON.stringify(buildSearchRequestBody({
                path: state.selectedPath,
                query: state.searchQuery,
                limit: 10,
                extensionFilterText: state.extensionFilterText,
                rankingProfile: state.rankingProfile,
            })),
        }), { targetPath: state.selectedPath });
        state.searchResults = data.results || [];
        state.searchContext = data;
        state.message = `Найдено результатов: ${state.searchResults.length}`;
    } catch (error) {
        state.error = sanitizeError(error);
    } finally {
        state.busy = false;
        render();
    }
}

async function copyDiagnostics(): Promise<void> {
    state.error = '';
    try {
        await actionRecorder.record('copy-diagnostics', async () => {
            if (!navigator.clipboard?.writeText) {
                throw new Error('Буфер обмена недоступен в текущем браузере.');
            }
            const payload = createDiagnosticsPayload({
                daemonSummary: state.status || null,
                selectedPath: state.selectedPath,
                selectedStatus: state.selectedStatus || null,
                actionLog: state.actionLog,
            });
            await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
        }, { targetPath: state.selectedPath || undefined });
        state.message = 'Диагностика скопирована.';
    } catch (error) {
        state.error = sanitizeError(error);
    } finally {
        render();
    }
}

async function copySearchText(value: string, successMessage: string): Promise<void> {
    state.error = '';
    try {
        if (!navigator.clipboard?.writeText) {
            throw new Error('Буфер обмена недоступен в текущем браузере.');
        }
        await navigator.clipboard.writeText(value);
        state.message = successMessage;
    } catch (error) {
        state.error = sanitizeError(error);
    } finally {
        render();
    }
}

function render(): void {
    const focusSnapshot = captureFocus();
    const runtimes = state.status?.runtimes || [];
    const primaryRuntime = runtimes[0];
    const activeIndexingJobs = collectIndexingJobs(runtimes, 'activeJobs');
    const queuedIndexingJobs = collectIndexingJobs(runtimes, 'queuedJobs');
    const indexingCount = activeIndexingJobs.length || runtimes.reduce((sum, runtime) => sum + (runtime.workload?.indexing?.activeCount || 0), 0);
    const queueCount = queuedIndexingJobs.length || runtimes.reduce((sum, runtime) => sum + (runtime.workload?.indexing?.queuedCount || 0), 0);
    const retrievalLabel = formatRetrieval(state.status?.retrievalConfiguration);

    root.innerHTML = `
        <div class="shell">
            <aside class="sidebar">
                <div class="brand">
                    <span class="brand-mark"></span>
                    <div>
                        <strong>Claude Context</strong>
                        <span>Local dashboard</span>
                    </div>
                </div>
                <form id="auth-form" class="auth-form">
                    <label class="field">
                        <span>Токен вручную</span>
                        <input id="token" type="password" autocomplete="off" placeholder="Не нужен при открытии через daemon" value="${escapeHtml(state.token)}" />
                    </label>
                    <button id="refresh" class="primary" ${state.busy ? 'disabled' : ''}>Обновить</button>
                </form>
                <div class="codebase-list">
                    ${state.codebases.map((codebase) => `
                        <button class="codebase ${codebase.path === state.selectedPath ? 'active' : ''}" data-path="${escapeHtml(codebase.path)}">
                            <span>${escapeHtml(shortPath(codebase.path))}</span>
                            <small>${escapeHtml(codebase.status)}</small>
                        </button>
                    `).join('')}
                </div>
            </aside>
            <main class="main">
                <section class="status-grid">
                    ${metric('Runtimes', String(runtimes.length), primaryRuntime?.healthy === false ? 'attention' : '')}
                    ${metric('Indexing', String(indexingCount), indexingCount > 0 ? 'working' : '')}
                    ${metric('Queued', String(queueCount), queueCount > 0 ? 'attention' : '')}
                    ${metric('Pressure', formatOptionalNumber(state.status?.accelerator?.adaptivePressureScore), '')}
                </section>
                <section class="toolbar">
                    <div>
                        <h1>${escapeHtml(shortPath(state.selectedPath || 'Кодовая база не выбрана'))}</h1>
                        <p>${escapeHtml(state.selectedPath || 'Выберите путь слева или обновите список.')}</p>
                        <p>${escapeHtml(retrievalLabel)}</p>
                    </div>
                    <div class="actions">
                        <button id="index" ${state.busy || !state.selectedPath ? 'disabled' : ''}>Индексировать</button>
                        <button id="cancel" ${state.busy || !state.selectedPath ? 'disabled' : ''}>Отменить</button>
                        <button id="clear" class="danger" ${state.busy || !state.selectedPath ? 'disabled' : ''}>Очистить</button>
                    </div>
                </section>
                ${operationsSection(activeIndexingJobs, queuedIndexingJobs, state.selectedStatus, state.status?.accelerator)}
                ${workerTelemetrySection(state.status)}
                ${state.error ? `<div class="notice error">${escapeHtml(state.error)}</div>` : ''}
                ${state.message ? `<div class="notice">${escapeHtml(state.message)}</div>` : ''}
                ${operatorLogSection(state.actionLog)}
                ${profileStateSection()}
                ${searchSection()}
                <section class="results">
                    ${state.searchResults.length === 0 ? '<p class="empty">Результатов пока нет.</p>' : state.searchResults.map((result, index) => `
                        <article class="result">
                            <header>
                                <div>
                                    <strong>${escapeHtml(result.relativePath)}</strong>
                                    <span>${escapeHtml(result.language || 'unknown')} · ${result.startLine}-${result.endLine} · ${result.score.toFixed(3)}</span>
                                </div>
                                <div class="result-actions">
                                    <button class="copy-location" data-result-index="${index}">Копировать путь</button>
                                    <button class="copy-snippet" data-result-index="${index}">Копировать фрагмент</button>
                                </div>
                            </header>
                            <pre>${escapeHtml(result.content)}</pre>
                            ${resultDetails(result)}
                        </article>
                    `).join('')}
                </section>
            </main>
        </div>
    `;

    bind();
    restoreFocus(focusSnapshot);
}

function searchSection(): string {
    const context = state.searchContext || {
        ...state.status?.retrievalConfiguration,
        ...selectedRetrievalContext(state.selectedStatus),
    };
    const contextItems = formatRetrievalContext(context);

    return `
        <section class="search-panel" aria-label="Поиск по коду">
            <div class="search">
                <input id="query" type="search" placeholder="Поиск по коду" value="${escapeHtml(state.searchQuery)}" />
                <button id="search" class="primary" ${state.busy ? 'disabled' : ''}>Искать</button>
            </div>
            <div class="search-options">
                <label class="field compact">
                    <span>Расширения</span>
                    <input id="extension-filter" type="text" placeholder=".bsl, .xml" value="${escapeHtml(state.extensionFilterText)}" />
                </label>
                <label class="field compact">
                    <span>Ранжирование</span>
                    <select id="ranking-profile" ${state.busy ? 'disabled' : ''}>
                        ${rankingOption('auto', 'auto')}
                        ${rankingOption('generic', 'generic')}
                        ${rankingOption('one-c', 'one-c')}
                    </select>
                </label>
            </div>
            <div class="retrieval-context">
                ${contextItems.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
                <span>Ранжирование: ${escapeHtml(state.searchContext?.rankingProfile || state.rankingProfile)}</span>
                ${state.searchContext?.indexingStatus ? `<span>Статус: ${escapeHtml(state.searchContext.indexingStatus)}</span>` : ''}
            </div>
        </section>
    `;
}

function bind(): void {
    document.querySelector<HTMLInputElement>('#token')?.addEventListener('input', (event) => {
        setToken((event.target as HTMLInputElement).value);
    });
    document.querySelector('#auth-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        void refresh({ showBusy: true, showMessage: true, forceRender: true });
    });
    document.querySelector('#index')?.addEventListener('click', () => void runAction('index'));
    document.querySelector('#clear')?.addEventListener('click', () => void runAction('clear'));
    document.querySelector('#cancel')?.addEventListener('click', () => void runAction('cancel'));
    document.querySelectorAll<HTMLButtonElement>('.cancel-job').forEach((button) => {
        button.addEventListener('click', () => {
            void runAction('cancel', button.dataset.path || '', button.dataset.kind || 'выбранную');
        });
    });
    document.querySelector<HTMLInputElement>('#query')?.addEventListener('input', (event) => {
        state.searchQuery = (event.target as HTMLInputElement).value;
    });
    document.querySelector<HTMLInputElement>('#extension-filter')?.addEventListener('input', (event) => {
        state.extensionFilterText = (event.target as HTMLInputElement).value;
    });
    document.querySelector<HTMLSelectElement>('#ranking-profile')?.addEventListener('change', (event) => {
        state.rankingProfile = (event.target as HTMLSelectElement).value as RankingProfile;
    });
    document.querySelector('#search')?.addEventListener('click', () => void search());
    document.querySelector('#copy-diagnostics')?.addEventListener('click', () => void copyDiagnostics());
    document.querySelectorAll<HTMLButtonElement>('.copy-location').forEach((button) => {
        button.addEventListener('click', () => {
            const result = state.searchResults[Number(button.dataset.resultIndex)];
            void copySearchText(result ? resultLocation(result) : '', 'Путь скопирован.');
        });
    });
    document.querySelectorAll<HTMLButtonElement>('.copy-snippet').forEach((button) => {
        button.addEventListener('click', () => {
            const result = state.searchResults[Number(button.dataset.resultIndex)];
            void copySearchText(result?.content || '', 'Фрагмент скопирован.');
        });
    });
    document.querySelectorAll<HTMLButtonElement>('.codebase').forEach((button) => {
        button.addEventListener('click', () => {
            state.selectedPath = button.dataset.path || '';
            state.selectedStatus = undefined;
            state.searchResults = [];
            state.searchContext = undefined;
            state.message = '';
            state.error = '';
            void refresh({ forceRender: true });
            render();
        });
    });
}

function rankingOption(value: RankingProfile, label: string): string {
    return `<option value="${value}" ${state.rankingProfile === value ? 'selected' : ''}>${label}</option>`;
}

function selectedRetrievalContext(status: CodebaseStatus | undefined): RetrievalContext {
    const raw = status as (CodebaseStatus & RetrievalContext) | undefined;
    return {
        retrievalProfile: raw?.retrievalProfile,
        retrievalMode: raw?.retrievalMode,
        retrievalSchemaVersion: raw?.retrievalSchemaVersion,
        oneCIndexScopeProfile: raw?.oneCIndexScopeProfile,
    };
}

function profileStateSection(): string {
    const fallbackRetrieval = {
        ...state.status?.retrievalConfiguration,
        ...selectedRetrievalContext(state.selectedStatus),
    };
    const profileState: DashboardProfileState = {
        ...(state.status?.profileState?.daemon ? { daemon: state.status.profileState.daemon } : {}),
        ...(state.selectedStatus?.profileState?.codebase ? { codebase: state.selectedStatus.profileState.codebase } : {}),
        ...(state.searchContext?.profileState?.search ? { search: state.searchContext.profileState.search } : {}),
    };
    const sections = buildProfileStateSections({
        profileState,
        fallbackRetrieval,
        fallbackRankingProfile: state.searchContext?.rankingProfile || state.rankingProfile,
    });

    return `
        <section class="profile-state" aria-label="Состояние профилей">
            <div class="section-heading">
                <div>
                    <h2>Профили</h2>
                    <p>Настройки демона, индекс выбранного репозитория и последний поиск.</p>
                </div>
            </div>
            <div class="profile-state-grid">
                ${sections.map((section) => `
                    <article class="profile-state-card ${section.tone}">
                        <h3>${escapeHtml(section.title)}</h3>
                        <ul>
                            ${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
                        </ul>
                    </article>
                `).join('')}
            </div>
        </section>
    `;
}

function resultDetails(result: SearchResult): string {
    const diagnostics = getResultDiagnostics(result);
    if (diagnostics.length === 0) {
        return '';
    }

    return `
        <details class="result-details">
            <summary>Диагностика результата</summary>
            <dl>
                ${diagnostics.map(([key, value]) => `
                    <dt>${escapeHtml(key)}</dt>
                    <dd>${escapeHtml(value)}</dd>
                `).join('')}
            </dl>
        </details>
    `;
}

function resultLocation(result: SearchResult): string {
    return `${result.relativePath}:${result.startLine}`;
}

function operatorLogSection(entries: ActionLogEntry[]): string {
    const visibleEntries = entries.slice().reverse();
    return `
        <section class="operator-log" aria-label="Журнал действий">
            <div class="section-heading">
                <div>
                    <h2>Журнал действий</h2>
                    <p>Последние операции панели в текущей вкладке.</p>
                </div>
                <button id="copy-diagnostics" ${state.busy ? 'disabled' : ''}>Копировать диагностику</button>
            </div>
            ${visibleEntries.length === 0 ? '<p class="empty small">Действий пока нет.</p>' : `
                <div class="log-list">
                    ${visibleEntries.map((entry) => `
                        <article class="log-entry ${entry.status}">
                            <div class="log-main">
                                <span class="status-label ${entry.status}">${escapeHtml(actionStatusLabel(entry.status))}</span>
                                <strong>${escapeHtml(actionLabel(entry.action))}</strong>
                                <small>${escapeHtml(formatActionTimestamp(entry.timestamp))}${entry.durationMs !== undefined ? ` · ${escapeHtml(formatDuration(entry.durationMs))}` : ''}</small>
                                ${entry.targetPath ? `<span title="${escapeHtml(entry.targetPath)}">${escapeHtml(entry.targetPath)}</span>` : ''}
                                ${entry.error ? `<p>${escapeHtml(entry.error)}</p>` : ''}
                            </div>
                        </article>
                    `).join('')}
                </div>
            `}
        </section>
    `;
}

function metric(label: string, value: string, tone: string): string {
    return `
        <div class="metric ${tone}">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
        </div>
    `;
}

function captureFocus(): { id: string; start: number | null; end: number | null } | undefined {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement) || !root.contains(active) || !active.id) {
        return undefined;
    }

    return {
        id: active.id,
        start: active.selectionStart,
        end: active.selectionEnd,
    };
}

function restoreFocus(snapshot: { id: string; start: number | null; end: number | null } | undefined): void {
    if (!snapshot) {
        return;
    }

    const next = document.getElementById(snapshot.id);
    if (!(next instanceof HTMLInputElement)) {
        return;
    }

    next.focus({ preventScroll: true });
    if (snapshot.start !== null && snapshot.end !== null) {
        next.setSelectionRange(snapshot.start, snapshot.end);
    }
}

function shortPath(value: string): string {
    const parts = value.split('/').filter(Boolean);
    return parts.slice(-2).join('/') || value;
}

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function actionLabel(action: ActionLogEntry['action']): string {
    switch (action) {
        case 'refresh':
            return 'Обновление';
        case 'index':
            return 'Индексация';
        case 'cancel':
            return 'Отмена';
        case 'clear':
            return 'Очистка';
        case 'search':
            return 'Поиск';
        case 'copy-diagnostics':
            return 'Копирование диагностики';
    }
}

function actionStatusLabel(status: ActionLogEntry['status']): string {
    switch (status) {
        case 'started':
            return 'идёт';
        case 'success':
            return 'успех';
        case 'failure':
            return 'ошибка';
    }
}

function formatActionTimestamp(value: string): string {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
        return value;
    }
    return new Date(parsed).toLocaleTimeString();
}

function formatDuration(value: number): string {
    if (value < 1000) {
        return `${value} мс`;
    }
    return `${(value / 1000).toFixed(1)} с`;
}

function collectIndexingJobs(
    runtimes: NonNullable<DaemonStatus['runtimes']>,
    field: 'activeJobs' | 'queuedJobs',
): WorkloadJob[] {
    return runtimes
        .filter((runtime) => runtime.healthy)
        .flatMap((runtime) => runtime.workload?.indexing?.[field] || []);
}

function operationsSection(
    activeJobs: WorkloadJob[],
    queuedJobs: WorkloadJob[],
    selectedStatus: CodebaseStatus | undefined,
    accelerator: DaemonStatus['accelerator'],
): string {
    return `
        <section class="operations" aria-label="Операции индексации">
            <div class="section-heading">
                <div>
                    <h2>Операции индексации</h2>
                    <p>Активные задания, очередь и прогресс выбранной кодовой базы.</p>
                </div>
                <span class="pill">${escapeHtml(String(activeJobs.length))} активно · ${escapeHtml(String(queuedJobs.length))} в очереди</span>
            </div>
            <div class="operations-grid">
                ${jobPanel('Активные', activeJobs, 'active')}
                ${jobPanel('В очереди', queuedJobs, 'queued')}
            </div>
            <div class="operations-grid">
                ${progressPanel(selectedStatus)}
                ${acceleratorPanel(accelerator)}
            </div>
        </section>
    `;
}

function workerTelemetrySection(status: DaemonStatus | undefined): string {
    const view = buildWorkerTelemetryView(status);

    return `
        <section class="worker-telemetry" aria-label="Телеметрия воркеров BGE-M3">
            <div class="section-heading">
                <div>
                    <h2>BGE-M3 воркеры</h2>
                    <p>Состояние пула, здоровье endpoint и план VRAM. Раздел только показывает данные.</p>
                </div>
                <span class="pill ${view.degraded ? 'attention' : ''}">${escapeHtml(view.available ? (view.degraded ? 'требует внимания' : 'доступно') : 'нет данных')}</span>
            </div>
            ${!view.available ? '<p class="empty small">Данные managed BGE-M3 workers сейчас недоступны.</p>' : `
                ${view.alerts.length > 0 ? `
                    <div class="worker-alerts">
                        ${view.alerts.map((alert) => `<p>${escapeHtml(alert)}</p>`).join('')}
                    </div>
                ` : ''}
                <div class="worker-summary">
                    ${view.summary.map(([label, value]) => telemetryMetric(label, value)).join('')}
                </div>
                <div class="worker-panels">
                    <article class="operation-panel">
                        <h3>Здоровье endpoint</h3>
                        ${view.endpoints.length === 0 ? '<p class="empty small">Нет строк здоровья endpoint.</p>' : `
                            <div class="endpoint-list">
                                ${view.endpoints.map((endpoint) => endpointRow(endpoint)).join('')}
                            </div>
                        `}
                    </article>
                    <article class="operation-panel">
                        <h3>План VRAM</h3>
                        <div class="vram-grid">
                            ${view.vram.map(([label, value]) => telemetryMetric(label, value)).join('')}
                        </div>
                    </article>
                </div>
            `}
        </section>
    `;
}

function telemetryMetric(label: string, value: string): string {
    return `
        <div class="telemetry-metric">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
        </div>
    `;
}

function endpointRow(endpoint: WorkerEndpointHealth): string {
    const rejected = endpoint.poolState === 'rejected' || Boolean(endpoint.rejectedReason);
    const health = endpoint.health || endpoint.poolState || 'unknown';
    const details = [
        `в работе ${formatOptionalNumber(endpoint.inFlight)}`,
        `попытки восстановления ${formatOptionalNumber(endpoint.recoveryAttempts)}`,
        endpoint.rejectedFailureReason ? `причина ${endpoint.rejectedFailureReason}` : '',
        endpoint.rejectedRetrySafe !== undefined ? `безопасный повтор ${String(endpoint.rejectedRetrySafe)}` : '',
    ].filter(Boolean).join(' · ');

    return `
        <div class="endpoint-row ${rejected ? 'rejected' : ''}">
            <div>
                <strong>${escapeHtml(endpoint.endpoint)}</strong>
                <span>${escapeHtml(details || 'нет дополнительных счётчиков')}</span>
                ${endpoint.rejectedReason ? `<small>${escapeHtml(endpoint.rejectedReason)}</small>` : ''}
            </div>
            <span class="status-label ${rejected ? 'failure' : 'success'}">${escapeHtml(health)}</span>
        </div>
    `;
}

function jobPanel(title: string, jobs: WorkloadJob[], kind: 'active' | 'queued'): string {
    const emptyText = kind === 'active'
        ? 'Активной индексации сейчас нет.'
        : 'Очередь индексации пуста.';
    const kindLabel = kind === 'active' ? 'активную' : 'ожидающую';

    return `
        <article class="operation-panel">
            <h3>${escapeHtml(title)}</h3>
            ${jobs.length === 0 ? `<p class="empty small">${escapeHtml(emptyText)}</p>` : `
                <div class="job-list">
                    ${jobs.map((job) => `
                        <div class="job-row">
                            <div class="job-main">
                                <strong title="${escapeHtml(job.codebasePath)}">${escapeHtml(shortPath(job.codebasePath))}</strong>
                                <span>${escapeHtml(job.codebasePath)}</span>
                                <small>${escapeHtml(jobMeta(job, kind))}</small>
                            </div>
                            <button class="danger cancel-job" data-path="${escapeHtml(job.codebasePath)}" data-kind="${escapeHtml(kindLabel)}" ${state.busy ? 'disabled' : ''}>Отменить</button>
                        </div>
                    `).join('')}
                </div>
            `}
        </article>
    `;
}

function progressPanel(status: CodebaseStatus | undefined): string {
    const summary = status ? buildProgressSummary(status) : undefined;
    const hasProgress = typeof summary?.percentage === 'number';

    return `
        <article class="operation-panel">
            <h3>Выбранная база</h3>
            ${summary ? `
                <div class="progress-summary">
                    <div>
                        <strong>${escapeHtml(hasProgress ? `${summary.percentage}%` : 'Статус')}</strong>
                        <span>${escapeHtml(summary.phase)}</span>
                        ${summary.countText ? `<small>${escapeHtml(summary.countText)}</small>` : ''}
                    </div>
                    ${hasProgress ? `<div class="progress-track"><span style="width: ${summary.percentage}%"></span></div>` : ''}
                    ${summary.statsText ? `<p>${escapeHtml(summary.statsText)}</p>` : ''}
                    ${summary.updatedText ? `<p>${escapeHtml(summary.updatedText)}</p>` : ''}
                </div>
            ` : '<p class="empty small">Статус выбранной кодовой базы пока недоступен.</p>'}
        </article>
    `;
}

function acceleratorPanel(accelerator: DaemonStatus['accelerator']): string {
    const counters = [
        ['Отправлено', accelerator?.submittedBatches],
        ['Готово', accelerator?.completedBatches],
        ['Ошибки', accelerator?.failedBatches],
        ['Повторы', accelerator?.retriedBatches],
        ['Очередь', accelerator?.queuedBatches],
        ['Векторизация', accelerator?.runningEmbeddingBatches],
        ['Запись в очереди', accelerator?.queuedInsertBatches],
        ['Запись', accelerator?.runningInsertBatches],
        ['Записано', accelerator?.completedInsertBatches],
        ['Ошибки записи', accelerator?.failedInsertBatches],
    ].filter(([, value]) => typeof value === 'number') as Array<[string, number]>;

    return `
        <article class="operation-panel">
            <h3>Пакеты ускорителя</h3>
            ${counters.length === 0 ? '<p class="empty small">Счётчики пакетов недоступны.</p>' : `
                <div class="counter-grid">
                    ${counters.map(([label, value]) => `
                        <div class="counter">
                            <span>${escapeHtml(label)}</span>
                            <strong>${escapeHtml(String(value))}</strong>
                        </div>
                    `).join('')}
                </div>
            `}
            ${accelerator?.adaptiveThrottleReason ? `<p>${escapeHtml(accelerator.adaptiveThrottleReason)}</p>` : ''}
            ${accelerator?.fallbackReason ? `<p>${escapeHtml(accelerator.fallbackReason)}</p>` : ''}
        </article>
    `;
}

function jobMeta(job: WorkloadJob, kind: 'active' | 'queued'): string {
    const parts = [
        job.type,
        `приоритет ${job.priority}`,
    ];
    if (kind === 'active' && job.startedAt) {
        parts.push(`работает ${formatElapsed(job.startedAt)}`);
    }
    if (kind === 'queued') {
        if (typeof job.queuePosition === 'number') {
            parts.push(`позиция ${job.queuePosition}`);
        }
        parts.push(`ждёт ${formatElapsed(job.enqueuedAt)}`);
    }
    if (job.cancelRequestedAt) {
        parts.push('отмена запрошена');
    }
    return parts.join(' · ');
}

function formatOptionalNumber(value: number | undefined): string {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
}

function formatElapsed(isoValue: string): string {
    const startedAt = Date.parse(isoValue);
    if (!Number.isFinite(startedAt)) {
        return 'неизвестно';
    }
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    if (seconds < 60) {
        return `${seconds} с`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return `${minutes} мин`;
    }
    const hours = Math.floor(minutes / 60);
    return `${hours} ч ${minutes % 60} мин`;
}

function formatRetrieval(config: DaemonStatus['retrievalConfiguration']): string {
    if (!config) {
        return 'Retrieval: неизвестно';
    }

    if (config.bgeM3Mode === 'dense' || config.retrievalMode === 'bge_m3_dense') {
        return `Retrieval: ${config.retrievalProfile || 'unset'} · BGE-M3 dense-only`;
    }

    if (config.usesBgeM3Sparse || config.usesColbert || config.retrievalMode === 'bge_m3_full') {
        return `Retrieval: ${config.retrievalProfile || 'unset'} · BGE-M3 dense+sparse+ColBERT`;
    }

    return `Retrieval: ${config.retrievalProfile || 'unset'} · ${config.retrievalMode || 'unknown'}`;
}

render();
void refresh();

window.setInterval(() => {
    if (!state.busy) {
        void refresh();
    }
}, 5000);
