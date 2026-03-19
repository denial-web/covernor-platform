import { prisma } from './client';
import * as crypto from 'crypto';

export class AuditLogger {
  /**
   * Appends an exhaustive log to the append-only AuditLog table using Cryptographic Hash-Chaining.
   */
  static async logAction(details: {
    tenantId?: string;
    proposalId?: string;
    decisionId?: string;
    actionDetails: any;
    
    // V2 Financial Fields
    amount?: number;
    currency?: string;
    recipientAccount?: string;
    providerTransactionId?: string;
    policyVersion?: string;
    approverIdentities?: string;
    reconciliationStatus?: string;
  }) {
    const tenantId = details.tenantId || 'default_tenant';
    
    // P1.5 Use Serializable Isolation Transaction to prevent Hash Chain Forks
    return await prisma.$transaction(async (tx) => {
      // 1. Fetch the most recent log for this tenant inside the transaction lock
      const lastLog = await tx.auditLog.findFirst({
          where: { tenantId },
          orderBy: { timestamp: 'desc' }
      });
      
      const previousHash = lastLog?.currentHash || null;
      
      // 2. Compute the current cryptograpic hash of the payload + previousHash
      const payloadString = JSON.stringify({
          tenantId,
          proposalId: details.proposalId,
          decisionId: details.decisionId,
          actionDetails: details.actionDetails,
          amount: details.amount,
          currency: details.currency,
          recipientAccount: details.recipientAccount,
          providerTransactionId: details.providerTransactionId,
          policyVersion: details.policyVersion,
          approverIdentities: details.approverIdentities,
          reconciliationStatus: details.reconciliationStatus,
          previousHash
      });
      
      const currentHash = crypto.createHash('sha256').update(payloadString).digest('hex');

      // 3. Append to the ledger safely inside the transaction
      return tx.auditLog.create({
        data: {
          tenantId,
          proposalId: details.proposalId,
          decisionId: details.decisionId,
          actionDetails: details.actionDetails,
          amount: details.amount,
          currency: details.currency,
          recipientAccount: details.recipientAccount,
          providerTransactionId: details.providerTransactionId,
          policyVersion: details.policyVersion,
          approverIdentities: details.approverIdentities,
          reconciliationStatus: details.reconciliationStatus,
          previousHash,
          currentHash
        },
      });
    }, {
      isolationLevel: 'Serializable',
      maxWait: 5000,
      timeout: 10000
    });
  }
}
