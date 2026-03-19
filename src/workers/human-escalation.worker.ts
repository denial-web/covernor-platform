import { prisma } from '../db/client';
import { logger } from '../utils/logger';
import { AuditLogger } from '../db/audit.logger';

/**
 * Periodically sweeps the Task table for `AWAITING_HUMAN` tasks whose
 * human intervention timeout (expiresAt) has elapsed.
 * Transitions them to the `EXPIRED` state to unlock the workflow securely.
 */
export class HumanEscalationWorker {
    private isRunning = false;
    private pollIntervalMs: number;

    constructor(pollIntervalMs: number = 60 * 1000) {
        this.pollIntervalMs = pollIntervalMs;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        logger.info(`[Escalation Worker] Starting background sweep for expired human escalations every ${this.pollIntervalMs}ms`);
        this.poll();
    }

    stop() {
        this.isRunning = false;
        logger.info("[Escalation Worker] Stopped.");
    }

    private async poll() {
        if (!this.isRunning) return;
        
        try {
            await this.sweepExpiredEscalations();
        } catch (error: any) {
            logger.error(`[Escalation Worker] Sweep Failed: ${error.message}`);
        } finally {
            if (this.isRunning) {
                setTimeout(() => this.poll(), this.pollIntervalMs);
            }
        }
    }

    async sweepExpiredEscalations() {
        const now = new Date();

        // Find expired tasks
        const expiredTasks = await prisma.task.findMany({
            where: {
                status: 'AWAITING_HUMAN',
                expiresAt: { lte: now }
            }
        });

        if (expiredTasks.length === 0) return;

        logger.warn(`[Escalation Worker] Found ${expiredTasks.length} expired 'AWAITING_HUMAN' tasks. Forcing to EXPIRED.`);

        for (const task of expiredTasks) {
            await prisma.task.update({
                where: { id: task.id },
                data: {
                    status: 'EXPIRED',
                }
            });
            logger.info(`[Escalation Lifecycle] Task ${task.id} timed out awaiting human review and was EXPIRED.`);
            
            await AuditLogger.logAction({
                tenantId: task.tenantId || 'system_worker',
                actionDetails: {
                    event: 'TASK_EXPIRED_AWAITING_HUMAN',
                    taskId: task.id
                }
            });
        }
    }
}
