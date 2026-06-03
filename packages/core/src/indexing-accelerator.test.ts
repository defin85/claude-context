import { envManager } from './utils/env-manager';
import {
    AsyncLimiter,
    getIndexingAcceleratorConfig,
    shouldAccelerateIndexing,
} from './indexing-accelerator';

describe('indexing accelerator configuration', () => {
    let getSpy: jest.SpyInstance<string | undefined, [name: string]>;

    beforeEach(() => {
        getSpy = jest.spyOn(envManager, 'get').mockReturnValue(undefined);
    });

    afterEach(() => {
        getSpy.mockRestore();
    });

    function mockEnv(values: Record<string, string | undefined>): void {
        getSpy.mockImplementation((name: string) => values[name]);
    }

    it('defaults to conservative single-worker behavior when disabled', () => {
        const config = getIndexingAcceleratorConfig();

        expect(config).toEqual({
            mode: 'off',
            embeddingConcurrency: 1,
            insertConcurrency: 1,
            maxBgeM3Workers: 1,
            vramLimitPercent: 75,
            retryBudget: 1,
            accelerateBackgroundSync: false,
        });
        expect(shouldAccelerateIndexing(config, {
            isInitialOrForce: true,
            isBackgroundSync: false,
        })).toEqual({
            active: false,
            fallbackReason: 'accelerator disabled',
        });
    });

    it('parses auto mode, concurrency, VRAM budget, retry budget, and background sync policy', () => {
        mockEnv({
            INDEX_ACCELERATOR_MODE: 'auto',
            INDEX_EMBEDDING_CONCURRENCY: '4',
            INDEX_INSERT_CONCURRENCY: '2',
            BGE_M3_ACCELERATOR_MAX_WORKERS: '3',
            BGE_M3_ACCELERATOR_VRAM_LIMIT_PERCENT: '75',
            INDEX_ACCELERATOR_RETRY_BUDGET: '5',
            INDEX_ACCELERATE_BACKGROUND_SYNC: 'true',
        });

        const config = getIndexingAcceleratorConfig();

        expect(config).toEqual({
            mode: 'auto',
            embeddingConcurrency: 4,
            insertConcurrency: 2,
            maxBgeM3Workers: 3,
            vramLimitPercent: 75,
            retryBudget: 5,
            accelerateBackgroundSync: true,
        });
        expect(shouldAccelerateIndexing(config, {
            isInitialOrForce: true,
            isBackgroundSync: false,
        })).toEqual({ active: true });
    });

    it('falls back for invalid values and clamps percent values', () => {
        mockEnv({
            BGE_M3_ACCELERATOR: 'auto',
            INDEX_EMBEDDING_CONCURRENCY: 'bad',
            INDEX_INSERT_CONCURRENCY: '-1',
            BGE_M3_ACCELERATOR_MAX_WORKERS: '0',
            BGE_M3_ACCELERATOR_VRAM_LIMIT_PERCENT: '500',
            INDEX_ACCELERATOR_RETRY_BUDGET: 'nope',
            INDEX_ACCELERATE_BACKGROUND_SYNC: 'maybe',
        });

        const config = getIndexingAcceleratorConfig();

        expect(config.mode).toBe('auto');
        expect(config.embeddingConcurrency).toBe(2);
        expect(config.insertConcurrency).toBe(1);
        expect(config.maxBgeM3Workers).toBe(1);
        expect(config.vramLimitPercent).toBe(100);
        expect(config.retryBudget).toBe(1);
        expect(config.accelerateBackgroundSync).toBe(false);
    });

    it('bounds async work to the configured limit', async () => {
        const limiter = new AsyncLimiter(2);
        let active = 0;
        let maxActive = 0;

        await Promise.all([0, 1, 2, 3].map((item) => limiter.run(async () => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, item === 0 ? 20 : 5));
            active--;
        })));

        expect(maxActive).toBe(2);
    });
});
