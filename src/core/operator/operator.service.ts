import { prisma } from '../../db/client';
import { AuditLogger } from '../../db/audit.logger';
import { BaseToolAdapter } from './tools/base.tool';
import { ReadDatabaseTool } from './tools/read-db.tool';
import { ModifyDatabaseTool } from './tools/modify-db.tool';
import { PostgreSQLOperator } from './tools/postgresql.operator';
import { HTTPOperator } from './tools/http.operator';
import { FileSystemOperator } from './tools/filesystem.operator';
import { SlackOperator } from './tools/slack.operator';
import { ZendeskOperator } from './tools/zendesk.operator';
import { TransferFundsOperator } from './tools/transfer-funds.tool';
import crypto from 'crypto';
import { KMSService, ApprovalTokenPayload } from '../crypto/kms.service';
import { CapabilityService } from '../policy/capability.registry';

import { OperatorExecutionError } from '../errors/pipeline.errors';
import { logger } from '../../utils/logger';
import Redis from 'ioredis';

const globalRedisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 1 });

export class OperatorService {
  private tools: Map<string, BaseToolAdapter> = new Map();

  constructor() {
    // Legacy generic mock tools
    this.registerTool(new ReadDatabaseTool());
    this.registerTool(new ModifyDatabaseTool());
    
    // Concrete P0 implementations
    this.registerTool(new PostgreSQLOperator());
    this.registerTool(new HTTPOperator());
    
    // Phase 4 Integrations
    this.registerTool(new FileSystemOperator());
    this.registerTool(new SlackOperator());
    this.registerTool(new ZendeskOperator());

    // Phase 10 Escalation Demo
    this.registerTool(new TransferFundsOperator());
  }

  private registerTool(tool: BaseToolAdapter) {
    this.tools.set(tool.actionType, tool);
  }

  /**
   * Retrieves an Operator's formal contract to allow the Covernor to enforce allowlists.
   */
  getToolContract(actionType: string) {
    const tool = this.tools.get(actionType);
    return tool ? tool.contract : undefined;
  }

  /**
   * Executes a Covernor-approved decision.
   */
  async executeDecision(decisionId: string) {
    try {
    const decision = await prisma.decision.findUnique({ where: { id: decisionId }, include: { proposal: true } });
    if (!decision) throw new Error("Decision not found");

    if (decision.decisionType !== 'APPROVE' && decision.decisionType !== 'APPROVE_WITH_CONSTRAINTS' && decision.decisionType !== 'HUMAN_OVERRIDE_APPROVED') {
        throw new Error("Cannot execute a non-approved decision.");
    }

    // Extract the action parameters from when the Advisor recommended them
    const actionPayload: any = decision.proposal.recommendedOption;
    
    // ------------------------------------------------------------------
    // v1.2 Hardening: Cryptographic Signed Token Verification
    // ------------------------------------------------------------------
    // We expect a cryptographically signed approval token for this decision
    const token = await prisma.approvalToken.findFirst({
        where: { decisionId: decision.id }
    });

    if (!token) {
        throw new Error("Security Violation: No Cryptographic Approval Token found for this decision. Operator Execution blocked.");
    }

    // 1. Validate Expiration
    if (token.expiresAt.getTime() < Date.now()) {
        throw new Error("Security Violation: Approval Token has expired.");
    }

    const capability = CapabilityService.getCapabilityForTool(actionPayload.actionType);
    if (!capability) {
        throw new Error(`Security Violation: Tool '${actionPayload.actionType}' has no authorized Capability mapping.`);
    }

    // 2. Reconstruct Token Payload exactly as signed
    const reconstructedPayload: ApprovalTokenPayload = {
      version: "1",
      decisionId: token.decisionId,
      tenantId: token.tenantId,
      taskId: token.taskId,
      proposalId: token.proposalId,
      operator: actionPayload.actionType,
      allowedActions: [actionPayload.actionType],
      payloadHash: token.payloadHash,
      scope: { capabilityIds: [capability.id] },
      nonce: token.nonce,
      expiresAt: token.expiresAt.getTime()
    };

    // 3. Verify Signature
    const isSignatureValid = KMSService.verifyTokenSignature(reconstructedPayload, token.signature);
    if (!isSignatureValid) {
        throw new Error("Security Violation: Approval Token signature is invalid. Possible tampering detected.");
    }

    // 4. Verify Payload Hash Matches the mathematical truth of the proposed action parameters
    const derivedHash = KMSService.generatePayloadHash(
       token.tenantId, token.taskId, token.proposalId, token.decisionId, actionPayload, token.nonce
    );
    if (derivedHash !== token.payloadHash) {
       throw new Error("Security Violation: Action payload was mutated after Covernor approval. Payload hashes do not match.");
    }

    // 5. Consume Single-Use Token
    const consumed = await KMSService.consumeToken(token.nonce);
    if (!consumed) {
       throw new Error("Security Violation: Replay Attack Detected. This Approval Token has already been used or expired.");
    }

    const tool = this.tools.get(actionPayload.actionType);
    if (!tool) {
        throw new Error(`Execution failed: Unsupported actionType '${actionPayload.actionType}'`);
    }

    // ------------------------------------------------------------------
    // Phase 3 Hardening: Financial Replay-Safe Execution State
    // ------------------------------------------------------------------
    const idempotencyKey = crypto.createHash('sha256')
       .update(`${decision.tenantId}|${decision.proposal.taskId}|${decision.id}`)
       .digest('hex');

    // V2 Financial Generation: The exact uniqueness token passed down to external APIs
    const providerIdempotencyKey = crypto.createHash('sha256')
       .update(`EXTERNAL|${decision.tenantId}|${decision.proposal.taskId}|${decision.id}`)
       .digest('hex');

    // Step 1: Reserve Execution
    let record = await prisma.executionRecord.findUnique({
        where: { decisionId: decision.id }
    });

    if (!record) {
        try {
            record = await prisma.executionRecord.create({
                data: {
                    decisionId: decision.id,
                    tenantId: decision.tenantId,
                    taskId: decision.proposal.taskId,
                    idempotencyKey,
                    providerIdempotencyKey,
                    status: 'PENDING'
                }
            });
        } catch (e: any) {
            record = await prisma.executionRecord.findUnique({ where: { decisionId: decision.id } });
            if (!record) throw e;
        }
    }

    if (record.status === 'COMPLETED') {
        logger.info(`[Operator] Decision ${decisionId} already COMPLETED. Returning early to prevent duplicate execution.`);
        return record;
    }
    if (record.status === 'EXECUTING') {
        throw new Error("Concurrency Violation: Decision is currently EXECUTING in another worker. Replay blocked.");
    }
    if (record.status === 'UNKNOWN') {
        throw new Error("State Violation: Decision is in UNKNOWN state. Requires human or automated reconciliation.");
    }

    // Step 2: Transition to EXECUTING atomically
    const rowsUpdated = await prisma.executionRecord.updateMany({
        where: { 
            decisionId: decision.id,
            status: { in: ['PENDING', 'FAILED'] }
        },
        data: {
            status: 'EXECUTING',
            attemptCount: { increment: 1 },
            startedAt: new Date(),
        }
    });

    if (rowsUpdated.count === 0) {
        throw new Error("Concurrency Violation: Failed to acquire EXECUTING lock. Another worker assumed control.");
    }

    // Prepare bounded sandbox context with idempotency key
    const context = { constraints: decision.constraints ? Object(decision.constraints) : undefined, providerIdempotencyKey, idempotencyKey };
    
    // ------------------------------------------------------------------
    // Operator Contract Enforcement Layer
    // ------------------------------------------------------------------
    const contract = tool.contract; 
    let toolResult: any;

    try {

        if (contract) {
            // 1. Enforce Idempotency Key Requirement
            if (contract.requiresIdempotencyKey && !context.providerIdempotencyKey) {
                 throw new Error(`Operator Contract Violation: 'providerIdempotencyKey' is required for ${actionPayload.actionType}.`);
            }

            // 3. Enforce Rate Limit per Minute
            if (contract.rateLimitPerMinute > 0) {
               try {
                  const rateKey = `operator_ratelimit:${decision.tenantId}:${actionPayload.actionType}`;
                  const luaScript = `
                    local current = redis.call('INCR', KEYS[1])
                    if current == 1 then
                        redis.call('EXPIRE', KEYS[1], ARGV[1])
                    end
                    return current
                  `;
                  const currentCount = await globalRedisClient.eval(luaScript, 1, rateKey, 60) as number;

                  if (currentCount > contract.rateLimitPerMinute) {
                     throw new Error(`Operator Contract Violation: Rate limit exceeded. Max ${contract.rateLimitPerMinute} requests per minute allowed for ${actionPayload.actionType}.`);
                  }
               } catch (redisError: any) {
                  logger.warn("Redis connectivity issue during operator rate limiting; failing closed.", { error: redisError.message });
                  throw new Error(`Infrastructure Violation: Unable to verify rate limits for ${actionPayload.actionType}`);
               }
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), contract.maxExecutionTimeMs);

            try {
              const timeoutPromise = new Promise<any>((_, reject) => {
                controller.signal.addEventListener('abort', () => reject(new Error(`Operator Execution Timeout: Exceeded ${contract.maxExecutionTimeMs}ms contract limit.`)));
              });

              // Execute Sandbox isolated tool wrapped in Promise.race
              const injectedContext = { ...context, abortSignal: controller.signal };
              toolResult = await Promise.race([
                tool.execute(actionPayload.parameters, injectedContext),
                timeoutPromise
              ]);
              clearTimeout(timeoutId);
            } catch (error: any) {
              clearTimeout(timeoutId);
              toolResult = { status: 'FAILED', failureCode: 'CONTRACT_VIOLATION', failedStep: 'execution_timeout', error: error.message };
            }
        } else {
            // Fallback for legacy tools lacking formalized contracts
            toolResult = await tool.execute(actionPayload.parameters, context);
        }
    } catch (crashErr: any) {
        // Step 4a: Handle Hard Crashes into UNKNOWN state
        await prisma.executionRecord.update({
            where: { decisionId: decision.id },
            data: { status: 'UNKNOWN', lastError: crashErr.message }
        });
        throw new Error(`Critical Operator Crash. State set to UNKNOWN. ${crashErr.message}`);
    }
    // ------------------------------------------------------------------
    
    // Step 4b: Finalize state
    let finalStatus = 'COMPLETED';
    let failedReason = null;
    let providerTransactionId = null;
    let errorClassification = null;
    
    if (toolResult) {
        if (toolResult.data?.transactionId) {
            providerTransactionId = String(toolResult.data.transactionId);
        }
        if (toolResult.errorClassification) {
            errorClassification = toolResult.errorClassification;
        }
    }

    if (toolResult && toolResult.status === 'FAILED') {
        finalStatus = 'FAILED';
        failedReason = toolResult.error || toolResult.failureCode;

        // V2 Financial: If we crash and don't know the external state, force manual review!
        if (errorClassification === 'UNKNOWN') {
            finalStatus = 'RECONCILIATION_REQUIRED';
        }
    }

    const report = await prisma.executionRecord.update({
      where: { decisionId: decision.id },
      data: {
        status: finalStatus,
        completedAt: (finalStatus === 'COMPLETED' || finalStatus === 'RECONCILIATION_REQUIRED') ? new Date() : null,
        lastError: failedReason,
        providerTransactionId,
        errorClassification,
        rollbackData: toolResult?.data?.rollbackData ? toolResult.data.rollbackData : undefined
      },
    });

    // We ALWAYS log the action, even if it failed, before throwing the exception
    await AuditLogger.logAction({
      tenantId: decision.tenantId,
      decisionId,
      actionDetails: {
        actor: 'Operator',
        action: 'execute_decision',
        toolExecuted: actionPayload.actionType,
        status: report.status,
        completedSteps: toolResult?.completedSteps || [],
        failureCode: toolResult?.failureCode || failedReason
      }
    });

    if (finalStatus === 'FAILED') {
      throw new OperatorExecutionError(decisionId, toolResult?.failureCode || 'UNKNOWN_ERROR', toolResult?.failedStep || 'unknown_step');
    }

    return report;
    } catch (outerError: any) {
         // Fail Task completely if a crash occurs prior to DB recording
         const decision = await prisma.decision.findUnique({ where: { id: decisionId }, include: { proposal: true }});
         if (decision && decision.proposal.taskId) {
            await prisma.task.update({ where: { id: decision.proposal.taskId }, data: { status: 'FAILED' }});
         }
         throw outerError;
    }
  }

  /**
   * Attempts to rollback a previous decision execution.
   */
  async executeRollback(reportId: string) {
    const report = await prisma.executionRecord.findUnique({ 
        where: { id: reportId },
        include: { decision: { include: { proposal: true } } }
    });

    if (!report) throw new Error("Execution record not found");
    if (report.status !== 'COMPLETED' && report.status !== 'PARTIAL_SUCCESS') throw new Error("Rollback is not available for this action state.");

    const actionPayload: any = report.decision.proposal.recommendedOption;
    const tool = this.tools.get(actionPayload.actionType);

    if (!tool || !tool.rollback) {
        throw new Error(`Rollback failed: Tool missing or does not support rollback for '${actionPayload.actionType}'`);
    }

    const contextParams = { rollbackActive: true, rollbackData: report.rollbackData };
    const rollbackSuccess = await tool.rollback(actionPayload.parameters, contextParams);

    // Rollback is fundamentally flawed in standard LLM apps. For now we use UNKNOWN 
    // to map to the strict finance spec, implying a human needs to verify external state.
    await prisma.executionRecord.update({
        where: { id: reportId },
        data: { status: rollbackSuccess ? 'UNKNOWN' : 'FAILED', lastError: 'Rollback invoked' }
    });

    await AuditLogger.logAction({
      tenantId: report.tenantId,
      decisionId: report.decisionId,
      actionDetails: {
        actor: 'Operator',
        action: 'execute_rollback',
        toolExecuted: actionPayload.actionType,
        rollbackSuccess
      }
    });

    return rollbackSuccess;
  }
}

