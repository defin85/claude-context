export interface CodebaseStatus {
    status?: string;
    indexingPercentage?: number;
    progressPercentage?: number;
    indexedFiles?: number;
    totalChunks?: number;
    lastUpdated?: string;
    progressDetails?: {
        phase?: string;
        current?: number;
        total?: number;
        percentage?: number;
    };
}

export interface ProgressSummary {
    percentage?: number;
    phase: string;
    countText: string;
    statsText: string;
    updatedText: string;
}

export function buildProgressSummary(status: CodebaseStatus): ProgressSummary {
    const details = status.progressDetails;
    const percentage = clampPercentage(details?.percentage ?? status.indexingPercentage ?? status.progressPercentage);
    const countText = typeof details?.current === 'number' && typeof details?.total === 'number'
        ? `${details.current}/${details.total}`
        : '';
    const statsText = [
        typeof status.indexedFiles === 'number' ? `Файлы: ${status.indexedFiles}` : '',
        typeof status.totalChunks === 'number' ? `Фрагменты: ${status.totalChunks}` : '',
    ].filter(Boolean).join(' · ');

    return {
        percentage,
        phase: details?.phase || status.status || 'Нет данных о прогрессе',
        countText,
        statsText,
        updatedText: status.lastUpdated ? `Обновлено: ${formatTimestamp(status.lastUpdated)}` : '',
    };
}

function clampPercentage(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    return Math.max(0, Math.min(100, Math.round(value)));
}

function formatTimestamp(value: string): string {
    return value.replace(/\.\d{3}Z$/, 'Z').replace('T', ' ').replace(/Z$/, '');
}
