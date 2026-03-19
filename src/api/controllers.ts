import { Request, Response } from 'express';
import { prisma } from '../db/client';
import { AuditLogger } from '../db/audit.logger';
import { WorkflowCoordinator } from '../core/workflow/coordinator.service';
import { OperatorService } from '../core/operator/operator.service';
import { logger } from '../utils/logger';
import { KMSService, ApprovalTokenPayload } from '../core/crypto/kms.service';
import { v4 as uuidv4 } from 'uuid';
import { PIIRedactor } from '../utils/pii.redactor';
import { CapabilityService } from '../core/policy/capability.registry';
import { workflowQueue } from '../core/workflow/coordinator.service';
const coordinator = WorkflowCoordinator.getInstance();

export const createTask = async (req: Request, res: Response) => {
  try {
    const { objective, context } = req.body;
    const tenantId = req.user!.tenantId;
    const idempotencyKey = req.headers['x-idempotency-key'] as string || undefined;

    if (!objective) return res.status(400).json({ error: 'Objective required' });
    if (typeof objective !== 'string') return res.status(400).json({ error: 'Objective must be a string' });
    if (objective.length > 5000) return res.status(400).json({ error: 'Objective too long (max 5000 chars)' });
    if (context !== undefined) {
      const contextStr = typeof context === 'string' ? context : JSON.stringify(context);
      if (contextStr.length > 50000) return res.status(400).json({ error: 'Context too large (max 50KB)' });
    }

    // Priority 2 Webhook Idempotency check 
    if (idempotencyKey) {
        const existingTask = await prisma.task.findUnique({
            where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } }
        });
        if (existingTask) {
             logger.info(`[Webhook] Duplicate idempotency key detected for tenant ${tenantId}. Returning existing task.`);
             return res.status(200).json({ message: 'Task already executed (Idempotent replay)', task: existingTask });
        }
    }

    const task = await prisma.task.create({
      data: { tenantId, idempotencyKey, objective, status: 'PENDING' }
    });

    // Start background workflow
    coordinator.processTask(task.id, objective, context, tenantId).catch((err: any) => logger.error("Background task execution failed", { error: err.message }));

    res.status(201).json({ message: 'Task created and workflow started', task });
  } catch (error: any) {
    logger.error("Failed to create task", { error: error.message });
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getProposal = async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const proposal = await prisma.proposal.findUnique({ where: { id: req.params.id as string } });
    if (!proposal || proposal.tenantId !== tenantId) return res.status(404).json({ error: 'Proposal not found' });
    res.json(proposal);
  } catch (error: any) {
    logger.error("Failed to fetch proposal", { error: error.message });
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getDecision = async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const decision = await prisma.decision.findFirst({ where: { proposalId: req.params.proposalId as string } });
    if (!decision || decision.tenantId !== tenantId) return res.status(404).json({ error: 'Decision not found' });
    res.json(decision);
  } catch (error: any) {
    logger.error("Failed to fetch decision", { error: error.message });
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getEscalatedDecisions = async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const decisions = await prisma.decision.findMany({ 
        where: { 
            tenantId,
            decisionType: 'BLOCK_AND_ESCALATE'
        },
        include: {
            proposal: {
                include: {
                    task: true
                }
            }
        },
        orderBy: { createdAt: 'desc' },
        take: 50
    });
    res.json(decisions);
  } catch (error: any) {
    logger.error("Failed to fetch escalated decisions", { error: error.message });
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const logs = await prisma.auditLog.findMany({ 
        where: { tenantId },
        orderBy: { timestamp: 'desc' }, 
        take: 100 
    });
    res.json(logs);
  } catch (error: any) {
    logger.error("Failed to fetch audit logs", { error: error.message });
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

const operator = new OperatorService();

/**
 * Human API: Allows administrators to manually unblock an ESCALATED decision and force Operator execution.
 */
export const overrideDecision = async (req: Request, res: Response) => {
  try {
    const decisionId = req.params.id as string;
    const tenantId = req.user!.tenantId;
    
    // 1. Validate Decision State
    const decision = await prisma.decision.findFirst({
      where: { id: decisionId, tenantId },
      include: { proposal: true }
    });

    if (!decision) {
      return res.status(404).json({ error: 'Decision not found' });
    }
    if (decision.decisionType !== 'BLOCK_AND_ESCALATE') {
      return res.status(400).json({ error: 'Decision is not in ESCALATED state awaiting human override.' });
    }

    // Priority 3 Security Hardening: Approval Token Anti-Replay
    const existingOverride = await prisma.decision.findFirst({
        where: { proposalId: decision.proposalId, decisionType: 'HUMAN_OVERRIDE_APPROVED' }
    });
    if (existingOverride) {
        logger.warn(`[Security API] Blocked replay attack on Decision ${decisionId}`);
        return res.status(403).json({ error: 'Security Violation: Escalation has already been overridden. Anti-Replay enforced.' });
    }

    // ------------------------------------------------------------------
    // V2.1 Financial: Dual Approval Multi-Signature Counting & Identity
    // ------------------------------------------------------------------
    const adminUserId = req.user?.userId || req.headers['x-user-id'] as string || 'anonymous_admin';
    const currentApprovers = decision.approverIdentities ? decision.approverIdentities.split(',') : [];

    if (currentApprovers.includes(adminUserId)) {
        logger.warn(`[Security API] Blocked Duplicate K-of-N Approval. User ${adminUserId} already approved Decision ${decisionId}.`);
        return res.status(403).json({ error: 'Security Violation: You have already provided your signature for this decision. Another unique administrator must approve.' });
    }

    if (Date.now() - decision.createdAt.getTime() > 1000 * 60 * 60 * 4) {
        logger.error(`[Security API] Decision ${decisionId} expired before collecting K-of-N signatures.`);
        return res.status(403).json({ error: 'Security Violation: This decision has expired waiting for human approval. The Advisor must replan.' });
    }

    currentApprovers.push(adminUserId);
    const updatedApproversString = currentApprovers.join(',');

    const atomicUpdate = await prisma.decision.updateMany({
        where: {
            id: decisionId,
            decisionType: 'BLOCK_AND_ESCALATE',
            approvalsCount: decision.approvalsCount,
        },
        data: {
            approvalsCount: { increment: 1 },
            approverIdentities: updatedApproversString,
        },
    });

    if (atomicUpdate.count === 0) {
        return res.status(409).json({ error: 'Concurrent approval detected. Please retry.' });
    }

    const updatedApprovalsCount = (decision.approvalsCount || 0) + 1;

    if (updatedApprovalsCount < decision.requiredApprovers) {
        logger.info(`[Human API] Recorded approval ${updatedApprovalsCount}/${decision.requiredApprovers} for Decision ${decisionId} by ${adminUserId}. Need more.`);
        return res.status(200).json({ 
            message: `Approval recorded. ${updatedApprovalsCount} of ${decision.requiredApprovers} obtained. Action is still PENDING.`,
            approvalsCount: updatedApprovalsCount,
            requiredApprovers: decision.requiredApprovers,
            approverIdentities: currentApprovers
        });
    }

    logger.info(`[Human API] Overriding Decision ${decisionId} (${updatedApprovalsCount}/${decision.requiredApprovers} approvals). Handing directly to Operator...`);

    // 2. Append-Only Overrides: Create a new Decision record instead of mutating the old one.
    const decisionIdToUse = uuidv4();
    const nonce = uuidv4();
    const recOpt = decision.proposal.recommendedOption as any;

    const payloadHash = KMSService.generatePayloadHash(
        decision.tenantId, decision.proposal.taskId, decision.proposalId, decisionIdToUse, recOpt, nonce
    );

    const cap = CapabilityService.getCapabilityForTool(recOpt.actionType);

    const tmpToken: ApprovalTokenPayload = {
      version: "1",
      decisionId: decisionIdToUse,
      tenantId: decision.tenantId,
      taskId: decision.proposal.taskId,
      proposalId: decision.proposalId,
      operator: recOpt.actionType,
      allowedActions: [recOpt.actionType],
      payloadHash: payloadHash,
      scope: {
         capabilityIds: [cap ? cap.id : recOpt.actionType]
      },
      nonce,
      expiresAt: Date.now() + (1000 * 60 * 15) // 15 minutes TTL for overridden capability tokens
    };

    const signature = KMSService.signToken(tmpToken);

    const overrideDecision = await prisma.decision.create({
      data: {
        id: decisionIdToUse,
        tenantId: decision.tenantId,
        proposalId: decision.proposalId,
        decisionType: 'HUMAN_OVERRIDE_APPROVED',
        riskLevel: decision.riskLevel,
        policyResults: decision.policyResults as any,
        constraints: decision.constraints as any,
        approvedPayloadHash: payloadHash,
        requiredApprovers: decision.requiredApprovers,
        approvalsCount: updatedApprovalsCount,
        approverIdentities: updatedApproversString
      }
    });

    await prisma.approvalToken.create({
       data: {
           nonce: tmpToken.nonce,
           decisionId: tmpToken.decisionId,
           tenantId: tmpToken.tenantId,
           taskId: tmpToken.taskId,
           proposalId: tmpToken.proposalId,
           payloadHash: tmpToken.payloadHash,
           signature: signature,
           expiresAt: new Date(tmpToken.expiresAt)
       }
    });

    await prisma.proposal.update({
      where: { id: decision.proposalId },
      data: { status: 'APPROVED' }
    });

    await AuditLogger.logAction({
      tenantId,
      proposalId: decision.proposalId,
      decisionId: overrideDecision.id,
      actionDetails: {
        actor: 'HumanOverride',
        action: 'approve_override',
        originalDecisionId: decisionId,
        approverIdentities: updatedApproversString,
        approvalsCount: updatedApprovalsCount,
        requiredApprovers: decision.requiredApprovers,
        performedBy: adminUserId,
      },
      approverIdentities: updatedApproversString,
    });

    // 3. Force Execution using the NEW decision ID
    const report = await operator.executeDecision(overrideDecision.id);

    // 4. Resolve Workflow and optimistic lock
    await prisma.task.update({
      where: { id: decision.proposal.taskId },
      data: { status: 'COMPLETED', version: { increment: 1 } }
    });

    res.json({ message: 'Decision overridden and executed successfully', report });
  } catch (error: any) {
    logger.error('[Human API] Operator Execution Failed after Override:', { error: error.message });
    res.status(500).json({ error: 'Operator Execution Failed' });
  }
};

/**
 * Platform Metrics API: Aggregates real-time statistics on Pipeline Health.
 * Intended for observability dashboards like Grafana or Datadog.
 */
export const getMetrics = async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;

    const totalTasks = await prisma.task.count({ where: { tenantId } });
    const tasksByStatus = await prisma.task.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { status: true }
    });

    const totalDecisions = await prisma.decision.count({ where: { tenantId } });
    const decisionsByType = await prisma.decision.groupBy({
      by: ['decisionType'],
      where: { tenantId },
      _count: { decisionType: true }
    });

    // Approximate latency calculation on recently completed execution records
    const recentExecutions = await prisma.executionRecord.findMany({
      take: 100,
      where: { tenantId, status: 'COMPLETED', completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true, decision: { select: { proposal: { select: { task: { select: { createdAt: true } } } } } } }
    });
    
    let averageLatencyMs = 0;
    if (recentExecutions.length > 0) {
      const latencies = recentExecutions.map((ex: any) => ex.completedAt.getTime() - ex.decision.proposal.task.createdAt.getTime());
      averageLatencyMs = latencies.reduce((a: number, b: number) => a + b, 0) / latencies.length;
    }

    // BullMQ Orchestrator Job Metrics
    const activeJobs = await workflowQueue.getActiveCount();
    const waitingJobs = await workflowQueue.getWaitingCount();
    const failedJobs = await workflowQueue.getFailedCount();

    // Approximate overall rejection and escalation rates
    const metricStats = {
      volume: {
        totalTasks,
        states: Object.fromEntries(tasksByStatus.map((s: any) => [s.status, s._count.status]))
      },
      orchestratorQueue: {
        active: activeJobs,
        waiting: waitingJobs,
        failed: failedJobs
      },
      governorDecisions: {
        totalRawEvals: totalDecisions,
        outcomes: Object.fromEntries(decisionsByType.map((d: any) => [d.decisionType, d._count.decisionType]))
      },
      performance: {
        averageTaskLatencyMs: Math.round(averageLatencyMs)
      }
    };

    res.json(metricStats);
  } catch (error: any) {
    logger.error("Failed to compile platform metrics", { error: error.message });
    res.status(500).json({ error: 'Metrics Aggregation Failed' });
  }
};

/**
 * AI Feedback Loop API: Exports rejected decisions as JSONL for LLM Fine-Tuning.
 * Grabs REJECT_AND_REPLAN or BLOCK_AND_ESCALATE proposals & pair them with the Covernor's reason.
 */
export const getTrainingDataset = async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;

    const rejectedDecisions = await prisma.decision.findMany({
      where: {
        tenantId,
        decisionType: {
          in: ['REJECT_AND_REPLAN', 'BLOCK_AND_ESCALATE']
        }
      },
      include: {
        proposal: {
          include: {
            task: true
          }
        }
      }
    });

    if (rejectedDecisions.length === 0) {
      return res.status(404).json({ message: "No rejected proposals found for training." });
    }

    // Format for OpenAI/Gemini JSONL Fine-tuning structure
    // Typically: {"messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
    // Here we'll output a custom structured format representing the Objective -> Proposal -> Correction loop.
    let jsonlOutput = "";
    
    for (const dec of rejectedDecisions) {
      // Phase 12: Safe Training Export Filtering
      // Deep redact the JSON representation of the proposal
      const recOpt = dec.proposal.recommendedOption as any;
      const sanitizedProposalOption = PIIRedactor.redactObject(recOpt);
      
      // Scrub the raw webhook strings (like Facebook messages or User emails)
      const sanitizedObjective = PIIRedactor.redact(dec.proposal.task.objective);

      const trainingExample = {
        prompt: `Objective: ${sanitizedObjective}\nAttempted Proposal: ${JSON.stringify(sanitizedProposalOption)}`,
        completion: `REJECTED. You must reconsider the constraints before proposing this action.`
      };
      // Note: we removed dec.reason since it wasn't natively exported on the Decision table (it is stored in policyResults context)
      // For a simple feedback loop string, we rely on a generic constraint reminder.
      jsonlOutput += JSON.stringify(trainingExample) + "\n";
    }

    res.setHeader('Content-Type', 'application/jsonl');
    res.setHeader('Content-Disposition', 'attachment; filename="advisor_finetuning_dataset.jsonl"');
    res.send(jsonlOutput);

  } catch (error: any) {
    logger.error("Failed to export training dataset", { error: error.message });
    res.status(500).json({ error: 'Dataset Export Failed' });
  }
};

/**
 * Policy Registry API: Rolls back the active Covernor Policy to a previous hash.
 */
export const rollbackPolicy = async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const { versionHash } = req.body;
    if (!versionHash) return res.status(400).json({ error: 'versionHash is required' });

    const targetPolicy = await prisma.governorPolicy.findFirst({
      where: { versionHash, tenantId }
    });

    if (!targetPolicy) return res.status(404).json({ error: 'Policy version not found in registry' });

    // Transaction to safely swap active policies
    await prisma.$transaction([
      prisma.governorPolicy.updateMany({
        where: { isActive: true, tenantId },
        data: { isActive: false }
      }),
      prisma.governorPolicy.update({
        where: { id: targetPolicy.id },
        data: { isActive: true }
      })
    ]);
    const userId = req.user?.userId || 'unknown';

    await AuditLogger.logAction({
      tenantId,
      actionDetails: {
        actor: 'Admin',
        action: 'policy_rollback',
        targetVersion: versionHash,
        performedBy: userId,
      },
      policyVersion: versionHash,
    });

    logger.info(`[Policy Registry] Covernor brain rolled back to ${versionHash} by ${userId}`);
    res.json({ message: `Successfully rolled back active policy to version: ${versionHash}` });
  } catch (error: any) {
    logger.error("Failed to rollback policy", { error: error.message });
    res.status(500).json({ error: 'Policy Rollback Failed' });
  }
};
