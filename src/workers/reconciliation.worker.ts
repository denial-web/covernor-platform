import { prisma } from '../db/client';
import { logger } from '../utils/logger';
import { AuditLogger } from '../db/audit.logger';

export class ReconciliationWorker {
  /**
   * Runs the reconciliation suite. In production, this would be triggered by a Cron job or BullMQ repeatable job.
   */
  async runSweep() {
    logger.info('[Reconciliation Worker] Starting Verification Sweep...');

    // 1. Find ExecutionRecords that have completed but are not yet reconciled
    const recordsToCheck = await prisma.executionRecord.findMany({
      where: {
        status: { in: ['COMPLETED', 'UNKNOWN', 'RECONCILIATION_REQUIRED'] },
      },
      include: {
         decision: { include: { proposal: true } }
      }
    });

    if (recordsToCheck.length === 0) {
      logger.info('[Reconciliation Worker] No records require reconciliation at this time.');
      return;
    }

    for (const record of recordsToCheck) {
      // Mock External Provider Lookup
      logger.info(`[Reconciliation Worker] Verifying internal Transaction ${record.id} against Provider ID: ${record.providerTransactionId}`);
      
      const realWorldState = this.mockPollProvider(record.providerTransactionId);

      // Verify alignment
      if (realWorldState.status === 'SUCCESS' && record.status === 'COMPLETED') {
         logger.info(`[Reconciliation Worker] Match confirmed for ${record.id}`);
         await this.markReconciled(record.id, 'RECONCILED', record.providerTransactionId);
      } else if (realWorldState.status === 'SUCCESS' && record.status !== 'COMPLETED') {
         logger.warn(`[Reconciliation Worker] DISCREPANCY: Provider reports SUCCESS, but internal is ${record.status}. Updating...`);
         await this.markReconciled(record.id, 'DISCREPANCY_FOUND_AND_FIXED', record.providerTransactionId);
         await prisma.executionRecord.update({
             where: { id: record.id },
             data: { status: 'COMPLETED' }
         });
      } else if (realWorldState.status === 'FAILED') {
         logger.error(`[Reconciliation Worker] DISCREPANCY: Provider reports FAILED. Triggering human escalation pipeline.`);
         await this.markReconciled(record.id, 'DISCREPANCY_PROVIDER_FAILED', record.providerTransactionId);
      } else if (realWorldState.status === 'UNAVAILABLE' || realWorldState.status === 'TIMEOUT') {
         // Phase 20: Bounded Exponential Backoff State Machine
         const currentAttempts = record.reconciliationAttempts || 0;
         const MAX_RECONCILIATION_ATTEMPTS = 5;

         if (currentAttempts >= MAX_RECONCILIATION_ATTEMPTS) {
             logger.error(`[Reconciliation Worker] TERMINAL FAILURE for ${record.id}. Exceeded ${MAX_RECONCILIATION_ATTEMPTS} attempts to reach provider ledger.`);
             await this.markReconciled(record.id, 'RECONCILIATION_FAILED', record.providerTransactionId);
             await prisma.executionRecord.update({
                 where: { id: record.id },
                 data: { 
                    status: 'RECONCILIATION_FAILED',
                    reconciliationAttempts: currentAttempts + 1
                 }
             });
         } else {
             logger.warn(`[Reconciliation Worker] Provider unavailable for ${record.id}. Attempt ${currentAttempts + 1} of ${MAX_RECONCILIATION_ATTEMPTS}. Backing off.`);
             await prisma.executionRecord.update({
                 where: { id: record.id },
                 data: { reconciliationAttempts: currentAttempts + 1 }
             });
         }
      }
    }

    logger.info('[Reconciliation Worker] Verification Sweep Finished.');
  }

  private async markReconciled(recordId: string, statusText: string, providerTransactionId: string | null) {
     // In a full implementation, we would update an explicit 'reconciliationStatus' on the ExecutionRecord itself.
     // For now, we'll log it as an audit trail update.
     
     await AuditLogger.logAction({
         tenantId: 'system_worker',
         actionDetails: {
             event: 'RECONCILIATION_SWEEP',
             result: statusText,
             executionRecordId: recordId,
             providerTransactionId
         }
     });

     if (statusText === 'RECONCILED' || statusText === 'DISCREPANCY_FOUND_AND_FIXED' || statusText === 'RECONCILIATION_FAILED' || statusText === 'DISCREPANCY_PROVIDER_FAILED') {
         await prisma.executionRecord.update({
             where: { id: recordId },
             data: { reconciledAt: new Date() }
         });
     }
  }

  /**
   * Mocks a GET /api/provider/ledger/:id call to check external state.
   */
  private mockPollProvider(providerTransactionId: string | null) {
      if (!providerTransactionId) return { status: 'FAILED', reason: 'Missing ID' };

      // Usually, it succeeds. We return SUCCESS.
      return { status: 'SUCCESS', id: providerTransactionId };
  }
}

// Allow running manually via script if invoked directly
if (require.main === module) {
  const worker = new ReconciliationWorker();
  worker.runSweep().then(() => {
      logger.info('Sweep executed.');
      process.exit(0);
  }).catch(e => {
      logger.error(e);
      process.exit(1);
  });
}
