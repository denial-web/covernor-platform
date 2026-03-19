import { prisma } from '../db/client';
import { logger } from '../utils/logger';
import { AuditLogger } from '../db/audit.logger';

/**
 * Sweeps the ExecutionRecords table for `EXECUTING` tasks that have been running longer
 * than a defined threshold, indicating a dropped connection or hard worker crash.
 * Translates them into the `UNKNOWN` state for human review or API reconciliation.
 */
export class ExecutionReconciliationWorker {
    private isRunning = false;
    private intervalParams: { thresholdMs: number, pollIntervalMs: number };

    constructor(thresholdMs: number = 5 * 60 * 1000, pollIntervalMs: number = 60 * 1000) {
        this.intervalParams = { thresholdMs, pollIntervalMs };
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        logger.info(`[Reconciliation Worker] Starting active sweep for ghost 'EXECUTING' records every ${this.intervalParams.pollIntervalMs}ms`);
        this.poll();
    }

    stop() {
        this.isRunning = false;
        logger.info("[Reconciliation Worker] Stopped.");
    }

    private async poll() {
        if (!this.isRunning) return;
        
        try {
            await this.sweepGhostExecutions();
        } catch (error: any) {
            logger.error(`[Reconciliation Worker] Sweep Failed: ${error.message}`);
        } finally {
            if (this.isRunning) {
                setTimeout(() => this.poll(), this.intervalParams.pollIntervalMs);
            }
        }
    }

    async sweepGhostExecutions() {
        const thresholdDate = new Date(Date.now() - this.intervalParams.thresholdMs);

        // Find stuck records
        const stuckRecords = await prisma.executionRecord.findMany({
            where: {
                status: 'EXECUTING',
                startedAt: { lte: thresholdDate }
            }
        });

        if (stuckRecords.length === 0) return;

        logger.warn(`[Reconciliation Worker] Found ${stuckRecords.length} ghost 'EXECUTING' records older than ${this.intervalParams.thresholdMs}ms. Forcing to UNKNOWN.`);

        // Force transition to UNKNOWN because we cannot guarantee what happened on the provider side
        for (const record of stuckRecords) {
            await prisma.executionRecord.update({
                where: { id: record.id },
                data: {
                    status: 'UNKNOWN',
                    lastError: `Reconciliation Worker: Forced to UNKNOWN after exceeding ${this.intervalParams.thresholdMs}ms timeout without completion.`
                }
            });
            
            // Log the anomaly securely
            logger.warn(`[Security Alert] ExecutionRecord ${record.id} forced from EXECUTING to UNKNOWN. Human verification of external provider required.`);
            
            await AuditLogger.logAction({
                tenantId: 'system_worker',
                actionDetails: {
                    event: 'RECONCILIATION_FORCED_UNKNOWN',
                    executionRecordId: record.id,
                    reason: `Forced to UNKNOWN after exceeding timeout`
                }
            });
        }
    }
}
