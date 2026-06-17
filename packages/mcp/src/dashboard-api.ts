type ToolArgs = Record<string, unknown>;
type ToolContent = Array<{ type: string; text?: string }>;

interface ToolResult {
    content?: ToolContent;
    structuredContent?: unknown;
    isError?: boolean;
}

interface DashboardToolHandlers {
    handleIndexCodebase(args: ToolArgs): Promise<ToolResult>;
    handleSearchCode(args: ToolArgs): Promise<ToolResult>;
    handleClearIndex(args: ToolArgs): Promise<ToolResult>;
    handleGetIndexingStatus(args: ToolArgs): Promise<ToolResult>;
}

export interface DashboardApiRequest {
    method: string;
    path: string;
    query: URLSearchParams;
    body?: unknown;
}

export interface DashboardApiResponse {
    statusCode: number;
    body: Record<string, unknown>;
}

interface DashboardApiAdapterOptions {
    toolHandlers: DashboardToolHandlers;
    getDaemonStatus(): Promise<ToolResult>;
    listCodebases(): Promise<Array<{ path: string; status: string }>>;
    cancelCodebaseWorkload(args: ToolArgs): Promise<ToolResult>;
}

export class DashboardApiAdapter {
    private readonly toolHandlers: DashboardToolHandlers;
    private readonly getDaemonStatus: () => Promise<ToolResult>;
    private readonly listCodebases: () => Promise<Array<{ path: string; status: string }>>;
    private readonly cancelCodebaseWorkload: (args: ToolArgs) => Promise<ToolResult>;

    constructor(options: DashboardApiAdapterOptions) {
        this.toolHandlers = options.toolHandlers;
        this.getDaemonStatus = options.getDaemonStatus;
        this.listCodebases = options.listCodebases;
        this.cancelCodebaseWorkload = options.cancelCodebaseWorkload;
    }

    public async handle(request: DashboardApiRequest): Promise<DashboardApiResponse> {
        try {
            if (request.method === 'GET' && request.path === '/api/daemon/status') {
                return this.fromToolResult(await this.getDaemonStatus());
            }

            if (request.method === 'GET' && request.path === '/api/codebases') {
                return this.ok(await this.listCodebases());
            }

            if (request.method === 'GET' && request.path === '/api/codebases/status') {
                const path = request.query.get('path');
                if (!path) {
                    return this.badRequest("Missing required query parameter 'path'.");
                }
                return this.fromToolResult(await this.toolHandlers.handleGetIndexingStatus({ path }));
            }

            if (request.method === 'POST' && request.path === '/api/codebases/index') {
                const body = this.requireBody(request.body);
                if (!body.ok) {
                    return body.response;
                }
                return this.fromToolResult(await this.toolHandlers.handleIndexCodebase(body.value));
            }

            if (request.method === 'POST' && request.path === '/api/codebases/clear') {
                const body = this.requireBody(request.body);
                if (!body.ok) {
                    return body.response;
                }
                return this.fromToolResult(await this.toolHandlers.handleClearIndex(body.value));
            }

            if (request.method === 'POST' && request.path === '/api/codebases/cancel') {
                const body = this.requireBody(request.body);
                if (!body.ok) {
                    return body.response;
                }
                return this.fromToolResult(await this.cancelCodebaseWorkload(body.value));
            }

            if (request.method === 'POST' && request.path === '/api/search') {
                const body = this.requireBody(request.body);
                if (!body.ok) {
                    return body.response;
                }
                return this.fromToolResult(await this.toolHandlers.handleSearchCode(body.value));
            }

            return {
                statusCode: 404,
                body: { ok: false, error: 'Dashboard API route not found.' }
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                statusCode: 500,
                body: { ok: false, error: message }
            };
        }
    }

    private requireBody(body: unknown): { ok: true; value: ToolArgs } | { ok: false; response: DashboardApiResponse } {
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return {
                ok: false,
                response: this.badRequest('Expected a JSON object request body.')
            };
        }

        return { ok: true, value: body as ToolArgs };
    }

    private fromToolResult(result: ToolResult): DashboardApiResponse {
        if (result.isError) {
            return {
                statusCode: 400,
                body: {
                    ok: false,
                    error: this.getToolText(result) || 'Dashboard operation failed.',
                    ...(result.structuredContent ? { data: result.structuredContent } : {})
                }
            };
        }

        return this.ok(result.structuredContent ?? { text: this.getToolText(result) });
    }

    private ok(data: unknown): DashboardApiResponse {
        return {
            statusCode: 200,
            body: { ok: true, data }
        };
    }

    private badRequest(error: string): DashboardApiResponse {
        return {
            statusCode: 400,
            body: { ok: false, error }
        };
    }

    private getToolText(result: ToolResult): string | undefined {
        return result.content
            ?.map((entry) => entry.text)
            .filter((text): text is string => typeof text === 'string')
            .join('\n');
    }
}
