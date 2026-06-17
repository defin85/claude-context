import './styles.css';

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
            indexing?: { activeCount?: number; queuedCount?: number };
            search?: { activeCount?: number; queuedCount?: number };
        };
    }>;
    accelerator?: {
        mode?: string;
        active?: boolean;
        effectiveEmbeddingConcurrency?: number;
        effectiveInsertConcurrency?: number;
        adaptivePressureScore?: number;
        adaptiveThrottleReason?: string;
        fallbackReason?: string;
    };
    workerPlanningPolicy?: {
        owner?: string;
        agentDirective?: string;
    };
    retrievalConfiguration?: {
        retrievalProfile?: string;
        retrievalMode?: string;
        bgeM3Mode?: string;
        usesBgeM3Sparse?: boolean;
        usesColbert?: boolean;
    };
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
}

interface SearchData {
    results?: SearchResult[];
}

const tokenKey = 'claude-context-dashboard-token';
const state = {
    token: sessionStorage.getItem(tokenKey) || '',
    status: undefined as DaemonStatus | undefined,
    codebases: [] as CodebaseSummary[],
    selectedPath: '',
    message: '',
    error: '',
    searchQuery: '',
    searchResults: [] as SearchResult[],
    busy: false,
    refreshInFlight: false,
};
let lastRefreshFingerprint = '';

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
        const nextFingerprint = JSON.stringify({ status, codebases, selectedPath });
        const shouldRender = options.forceRender || nextFingerprint !== lastRefreshFingerprint;

        state.status = status;
        state.codebases = codebases;
        state.selectedPath = selectedPath;
        lastRefreshFingerprint = nextFingerprint;
        if (options.showMessage) {
            state.message = `Обновлено: ${new Date().toLocaleTimeString()}`;
        }
        if (shouldRender || options.showMessage) {
            render();
        }
    } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        render();
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

async function runAction(action: 'index' | 'clear' | 'cancel'): Promise<void> {
    if (!state.selectedPath) {
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
        (action === 'clear' && !window.confirm(`Очистить индекс для ${state.selectedPath}?`))
        || (action === 'cancel' && !window.confirm(`Отменить индексацию для ${state.selectedPath}?`))
    ) {
        return;
    }

    state.busy = true;
    state.error = '';
    render();
    try {
        await api(route, {
            method: 'POST',
            body: JSON.stringify({
                path: state.selectedPath,
                ...(action === 'index' ? { splitter: 'ast' } : {}),
                ...(action === 'cancel' ? { reason: 'Cancelled from web dashboard.' } : {}),
            }),
        });
        state.message = action === 'index'
            ? 'Индексация поставлена в очередь.'
            : action === 'clear'
                ? 'Индекс очищен.'
                : 'Отмена отправлена.';
        await refresh({ forceRender: true });
    } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
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
        const data = await api<SearchData>('/search', {
            method: 'POST',
            body: JSON.stringify({
                path: state.selectedPath,
                query: state.searchQuery,
                limit: 10,
            }),
        });
        state.searchResults = data.results || [];
        state.message = `Найдено результатов: ${state.searchResults.length}`;
    } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
    } finally {
        state.busy = false;
        render();
    }
}

function render(): void {
    const runtimes = state.status?.runtimes || [];
    const primaryRuntime = runtimes[0];
    const indexingCount = runtimes.reduce((sum, runtime) => sum + (runtime.workload?.indexing?.activeCount || 0), 0);
    const queueCount = runtimes.reduce((sum, runtime) => sum + (runtime.workload?.indexing?.queuedCount || 0), 0);
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
                    ${metric('Pressure', String(state.status?.accelerator?.adaptivePressureScore ?? 0), '')}
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
                ${state.error ? `<div class="notice error">${escapeHtml(state.error)}</div>` : ''}
                ${state.message ? `<div class="notice">${escapeHtml(state.message)}</div>` : ''}
                <section class="search">
                    <input id="query" type="search" placeholder="Поиск по коду" value="${escapeHtml(state.searchQuery)}" />
                    <button id="search" class="primary" ${state.busy ? 'disabled' : ''}>Искать</button>
                </section>
                <section class="results">
                    ${state.searchResults.length === 0 ? '<p class="empty">Результатов пока нет.</p>' : state.searchResults.map((result) => `
                        <article class="result">
                            <header>
                                <strong>${escapeHtml(result.relativePath)}</strong>
                                <span>${escapeHtml(result.language || 'unknown')} · ${result.startLine}-${result.endLine} · ${result.score.toFixed(3)}</span>
                            </header>
                            <pre>${escapeHtml(result.content)}</pre>
                        </article>
                    `).join('')}
                </section>
            </main>
        </div>
    `;

    bind();
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
    document.querySelector<HTMLInputElement>('#query')?.addEventListener('input', (event) => {
        state.searchQuery = (event.target as HTMLInputElement).value;
    });
    document.querySelector('#search')?.addEventListener('click', () => void search());
    document.querySelectorAll<HTMLButtonElement>('.codebase').forEach((button) => {
        button.addEventListener('click', () => {
            state.selectedPath = button.dataset.path || '';
            render();
        });
    });
}

function metric(label: string, value: string, tone: string): string {
    return `
        <div class="metric ${tone}">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
        </div>
    `;
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
