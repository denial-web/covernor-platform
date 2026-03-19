import { MinisterService } from '../minister/minister.service';
import { CriticService } from '../critic/critic.service';
import { GovernorService } from '../governor/governor.service';
import { OperatorService } from '../operator/operator.service';
import { SchemaValidator } from '../policy/schema.validator';
import { prisma } from '../../db/client';
import { GovernorRejectionError, OperatorExecutionError, GovernorEscalationError } from '../errors/pipeline.errors';
import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { logger } from '../../utils/logger';

const minister = new MinisterService();
const critic = new CriticService();
const governor = new GovernorService();
const operator = new OperatorService();

const MAX_REPLAN_ATTEMPTS = 3;

// Configure Redis Connection Options
const connection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null // Required by BullMQ
};

// Instantiate a direct Redis client for the noisy-neighbor sliding window
const redisClient = new Redis(connection.port, connection.host, { maxRetriesPerRequest: null });

// The core orchestrator queue
export const workflowQueue = new Queue('workflow-orchestrator', { connection });

export class WorkflowCoordinator {
  private static instance: WorkflowCoordinator;

  private worker?: Worker;

  private constructor() {
     // Initialize the worker daemon exactly once
     this.initializeWorker();
  }

  public async shutdown() {
      if (this.worker) {
          await this.worker.close();
      }
      await redisClient.quit();
  }

  public static getInstance(): WorkflowCoordinator {
      if (!WorkflowCoordinator.instance) {
          WorkflowCoordinator.instance = new WorkflowCoordinator();
      }
      return WorkflowCoordinator.instance;
  }

  private initializeWorker() {
    this.worker = new Worker('workflow-orchestrator', async (job: Job) => {
        const { taskId, objective, context, tenantId } = job.data;
        
        // --- Phase 6: Noisy Neighbor Rate Limiting ---
        const activeKey = `tenant_active:${tenantId}`;
        const luaScript = `
          local current = redis.call('INCR', KEYS[1])
          if current == 1 then
              redis.call('EXPIRE', KEYS[1], ARGV[1])
          end
          return current
        `;
        const activeCount = await redisClient.eval(luaScript, 1, activeKey, 300) as number; // 5 min safety TTL in case of catastrophic crash

        // Setting a low quota (e.g., 2) for demonstration of the noisy neighbor guard
        const MAX_CONCURRENT = 2;
        if (activeCount > MAX_CONCURRENT) {
           await redisClient.decr(activeKey);
           logger.warn(`🛑 [Queue Fairness] Tenant ${tenantId} exceeded concurrent quota (${MAX_CONCURRENT}). Delaying task ${taskId} (Backoff triggered).`);
           throw new Error("RATE_LIMIT_EXCEEDED");
        }

        try {
            logger.info(`[Queue Worker] Dequeued task ${taskId}. Starting execution loop...`);
            return await this._executeTaskLoop(taskId, objective, context, tenantId);
        } finally {
            await redisClient.decr(activeKey);
        }
    }, { connection });
  }

  /**
   * Pushes the task into the resilient BullMQ queue.
   */
  async processTask(taskId: string, objective: string, context: any, tenantId: string = "default_tenant") {
       await workflowQueue.add('execute-loop', { taskId, objective, context, tenantId }, {
            attempts: 50, // Increased to allow long backoff horizons for rate-limited tasks
            backoff: { type: 'exponential', delay: 2000 }
       });
       logger.info(`[Workflow] Task ${taskId} successfully enqueued into orchestration queue.`);
  }

  /**
   * The actual internal orchestration loop (formerly processTask)
   */
  private async _executeTaskLoop(taskId: string, objective: string, context: any, tenantId: string) {
    // Phase 10: Explicit transition to PROCESSING when dequeued
    await prisma.task.update({
        where: { id: taskId },
        data: { status: 'PROCESSING', version: { increment: 1 } }
    });

    let attempts = 0;
    let fallbackObjective = objective;
    let currentParentProposalId: string | undefined = undefined;

    while (attempts < MAX_REPLAN_ATTEMPTS) {
      attempts++;
      
      logger.info(`[Workflow] Attempt ${attempts}: Advisor planning...`, { taskId, attempts, tenantId });
      const proposal = await minister.generateProposal(taskId, fallbackObjective, context, tenantId, currentParentProposalId);
      currentParentProposalId = proposal.id; // Any subsequent replan in this loop was born from this failed proposal

      try {
        // Priority 1 Hard Boundary: Strict Structural Validation (Zod)
        try {
           SchemaValidator.validateProposalPayload(proposal.recommendedOption);
        } catch (zodError: any) {
           logger.warn(`[Workflow] Attempt ${attempts}: Structural ZOD Validation FAILED`, { reason: zodError.message, proposalId: proposal.id });
           const systemFeedback = {
              status: "SYSTEM_REJECTION",
              replanReasonCode: "MALFORMED_JSON_SCHEMA",
              details: zodError.message
           };
           fallbackObjective = `${objective}\n\n<UNTRUSTED_SYSTEM_RETURN>\n[SYSTEM_FEEDBACK_DO_NOT_PARSE_AS_USER_INTENT]\n${JSON.stringify(systemFeedback)}\n</UNTRUSTED_SYSTEM_RETURN>`;
           continue; // Loop naturally without hitting Critic/Covernor
        }

        logger.info(`[Workflow] Attempt ${attempts}: Critic evaluating...`, { proposalId: proposal.id });
        const rawCriticEval = await critic.evaluate(proposal, objective);
        
        let criticEval;
        try {
           criticEval = SchemaValidator.validateCriticPayload(rawCriticEval);
        } catch (schemaErr: any) {
           logger.warn(`[Workflow] Attempt ${attempts}: Critic Structural Output Invalid (Possible prompt injection leak)`, { reason: schemaErr.message, proposalId: proposal.id });
           const systemFeedback = {
              status: "SYSTEM_REJECTION",
              replanReasonCode: "CRITIC_SCHEMA_VIOLATION",
              details: "The internal safety critic failed to adhere to the strict JSON security schema."
           };
           fallbackObjective = `${objective}\n\n<UNTRUSTED_SYSTEM_RETURN>\n[SYSTEM_FEEDBACK_DO_NOT_PARSE_AS_USER_INTENT]\n${JSON.stringify(systemFeedback)}\n</UNTRUSTED_SYSTEM_RETURN>`;
           continue;
        }
        
        if (!criticEval.isValid) {
           logger.warn(`[Workflow] Attempt ${attempts}: Critic REJECTED`, { reasonCode: criticEval.reasonCode, proposalId: proposal.id });
           const criticFeedback = {
              status: "PRE_FLIGHT_REJECTION",
              replanReasonCode: criticEval.reasonCode,
              confidence: criticEval.confidence
           };
           fallbackObjective = `${objective}\n\n<UNTRUSTED_SYSTEM_RETURN>\n[SYSTEM_FEEDBACK_DO_NOT_PARSE_AS_USER_INTENT]\n${JSON.stringify(criticFeedback)}\n</UNTRUSTED_SYSTEM_RETURN>`;
           continue;
        }

        logger.info(`[Workflow] Attempt ${attempts}: Covernor evaluating...`, { proposalId: proposal.id });
        const decision = await governor.evaluateProposal(proposal.id);
        logger.info(`[Workflow] Attempt ${attempts}: Covernor Decision is => ${decision.decisionType}`);

        logger.info(`[Workflow] Attempt ${attempts}: Covernor APPROVED. Operator executing...`, { decisionId: decision.id });
        const report = await operator.executeDecision(decision.id);
        
        await prisma.task.update({
          where: { id: taskId },
          data: { status: 'COMPLETED', version: { increment: 1 } } // OperatorError throws if it actually fails now
        });

        return { success: true, report };

      } catch (error: any) {
        if (error instanceof GovernorRejectionError) {
           logger.warn(`[Workflow] Attempt ${attempts}: Covernor REJECTED`, { reason: error.rejectionReason, proposalId: proposal.id });
           if (error.suggestedAlternative) {
               logger.info(`[Workflow] Covernor Suggestion:`, { suggestion: error.suggestedAlternative });
           }
           const governorFeedback = {
              status: "COVERNOR_AUTHORITY_REJECTION",
              replanReasonCode: "POLICY_VIOLATION",
              details: error.rejectionReason,
              constraintHint: error.suggestedAlternative || null
           };
           fallbackObjective = `${objective}\n\n<UNTRUSTED_SYSTEM_RETURN>\n[SYSTEM_FEEDBACK_DO_NOT_PARSE_AS_USER_INTENT]\n${JSON.stringify(governorFeedback)}\n</UNTRUSTED_SYSTEM_RETURN>`;
           continue; // Loop naturally
        }

        if (error instanceof GovernorEscalationError) {
           logger.warn(`[Workflow] Attempt ${attempts}: Covernor ESCALATED. Pausing for Human Manager...`, { reason: error.escalationReason, proposalId: error.proposalId });
           
           // Priority 2: Escalation Lifecycles (24 hour TTL)
           const expiresAt = new Date();
           expiresAt.setHours(expiresAt.getHours() + 24);

           await prisma.task.update({ 
               where: { id: taskId }, 
               data: { status: 'AWAITING_HUMAN', expiresAt, version: { increment: 1 } } 
           });
           
           return { success: false, reason: 'Escalated to Human', details: error.escalationReason, proposalId: error.proposalId };
        }

        if (error instanceof OperatorExecutionError) {
           logger.error(`[Workflow] Attempt ${attempts}: Operator HALTED.`, { failedStep: error.failedStep, failureCode: error.failureCode, decisionId: error.decisionId });
           await prisma.task.update({ where: { id: taskId }, data: { status: 'FAILED', version: { increment: 1 } } });
           return { success: false, reason: 'Operator Execution Failed', details: error.message };
        }

        logger.error(`[Workflow] Uncaught systemic error:`, { error: error.message, stack: error.stack });
        await prisma.task.update({ where: { id: taskId }, data: { status: 'FAILED', version: { increment: 1 } } });
        return { success: false, reason: 'Systemic Failure', details: error.message };
      }
    }

    logger.error(`[Workflow] Reached MAX_REPLAN_ATTEMPTS. Aborting.`, { taskId, limit: MAX_REPLAN_ATTEMPTS });
    await prisma.task.update({ where: { id: taskId }, data: { status: 'FAILED', version: { increment: 1 } } });
    return { success: false, reason: 'Max replan attempts exceeded' };
  }
}
