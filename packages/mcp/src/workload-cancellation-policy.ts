import { CancelledWorkloadSummary } from './workload-manager.js';

export function shouldStopManagedWorkersAfterCancellation(cancellation: CancelledWorkloadSummary): boolean {
    return cancellation.active.length > 0;
}
