import { prisma } from '../../db/client';
import { AuditLogger } from '../../db/audit.logger';
import { GovernorRejectionError, GovernorEscalationError } from '../errors/pipeline.errors';
import { PolicyEngine } from './policies/engine';
import { OperatorService } from '../operator/operator.service';
import { logger } from '../../utils/logger';
import crypto from 'crypto';
import { KMSService, ApprovalTokenPayload } from '../crypto/kms.service';
import { v4 as uuidv4 } from 'uuid';
import { CapabilityService } from '../policy/capability.registry';
import Redis from 'ioredis';

const connection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null
};
const redisClient = new Redis(connection.port, connection.host, { maxRetriesPerRequest: null });

const engine = new PolicyEngine();
const operatorService = new OperatorService();

export class GovernorService {
  /**
   * Safe graceful shutdown hook
   */
  public static async shutdown() {
      await redisClient.quit();
  }

  /**
   * Evaluates a proposal against policy rules, returning a deterministic decision.
   */
  async evaluateProposal(proposalId: string) {
    const proposal = await prisma.proposal.findUnique({ 
        where: { id: proposalId },
        include: { task: true }
    });
    if (!proposal) throw new Error("Proposal not found");

    const recommendedOption: any = proposal.recommendedOption;
    
    // ------------------------------------------------------------------
    // Phase 2 Hardening: Capability Registry Authorization
    // ------------------------------------------------------------------
    const capability = CapabilityService.getCapabilityForTool(recommendedOption.actionType);
    if (!capability) {
        throw new GovernorRejectionError(proposalId, `Capability Verification Failed: The proposed tool '${recommendedOption.actionType}' is not bound to any authorized system capability.`);
    }

    // ------------------------------------------------------------------
    // Priority 1 Hard Boundary: Operator Parameter Allowlist Enforcement
    // ------------------------------------------------------------------
    const contract = operatorService.getToolContract(recommendedOption.actionType);
    if (!contract) {
       throw new GovernorRejectionError(proposalId, `Execution blocked: Unsupported tool '${recommendedOption.actionType}'. Check allowed tool list.`);
    }

    if (contract.allowedParameterSchema) {
       try {
          contract.allowedParameterSchema.parse(recommendedOption.parameters);
       } catch (error: any) {
          logger.warn(`[Covernor] Operator Allowlist Violation`, { issues: error.issues });
          throw new GovernorRejectionError(proposalId, `Operator Contract Violation: The provided parameters for ${recommendedOption.actionType} strictly violated explicit allowlists. Details: ${error.message}`);
       }
    }

    // ------------------------------------------------------------------
    // Scope Limit Enforcement: maxRowsAffected from OperatorContract
    // ------------------------------------------------------------------
    if (contract.maxRowsAffected > 0) {
       const requestedRows = recommendedOption.parameters?.limit
         ?? recommendedOption.parameters?.maxRows
         ?? recommendedOption.parameters?.count;
       if (typeof requestedRows === 'number' && requestedRows > contract.maxRowsAffected) {
          throw new GovernorRejectionError(
            proposalId,
            `Scope Limit Violation: Requested ${requestedRows} rows but operator contract for '${recommendedOption.actionType}' allows max ${contract.maxRowsAffected}.`
          );
       }
    }

    // ------------------------------------------------------------------
    // Capability Scope Limit Enforcement: defaultScopeLimits from Registry
    // ------------------------------------------------------------------
    if (capability.defaultScopeLimits) {
       const limits = capability.defaultScopeLimits;
       const params = recommendedOption.parameters || {};

       if (limits.maxAmount !== undefined && typeof params.amount === 'number') {
          if (params.amount > limits.maxAmount) {
             throw new GovernorRejectionError(
               proposalId,
               `Capability Scope Violation: Amount ${params.amount} exceeds capability limit of ${limits.maxAmount} for '${capability.id}'.`
             );
          }
       }

       if (limits.maxRows !== undefined) {
          const rows = params.limit ?? params.maxRows ?? params.count;
          if (typeof rows === 'number' && rows > limits.maxRows) {
             throw new GovernorRejectionError(
               proposalId,
               `Capability Scope Violation: Row count ${rows} exceeds capability limit of ${limits.maxRows} for '${capability.id}'.`
             );
          }
       }

       if (limits.currency !== undefined && params.currency) {
          if (String(params.currency).toUpperCase() !== String(limits.currency).toUpperCase()) {
             throw new GovernorRejectionError(
               proposalId,
               `Capability Scope Violation: Currency '${params.currency}' not allowed. Capability '${capability.id}' only permits '${limits.currency}'.`
             );
          }
       }
    }
    // ------------------------------------------------------------------

    // Phase 5: Provenance Enforcement - Evaluate both parameters AND the runtime contextual metadata (e.g. Provenance source)
    const contextSignals: any = proposal.contextSignals || {};
    const { results: policyResults, versionHash } = await engine.evaluateOptions(recommendedOption.actionType, recommendedOption.parameters, contextSignals);
    
    // Determine overall risk and decision type
    let decisionType = 'APPROVE';
    let highestRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    let combinedConstraints: Record<string, any> = {};
    const formattedResults: Record<string, any> = {};
    let requiredApprovers = 1;

    for (const res of policyResults) {
      formattedResults[res.policyId] = res;
      
      // Upgrade risk level if higher
      if (res.riskAssigned === 'CRITICAL') highestRisk = 'CRITICAL';
      else if (res.riskAssigned === 'HIGH' && highestRisk !== 'CRITICAL') highestRisk = 'HIGH';
      else if (res.riskAssigned === 'MEDIUM' && highestRisk === 'LOW') highestRisk = 'MEDIUM';

      // Determine decision
      if (res.action === 'REJECT') {
        decisionType = 'REJECT_AND_REPLAN';
        break; // Stop evaluating on first hard reject
      } else if (res.action === 'REQUIRE_DUAL_APPROVAL') {
        decisionType = 'BLOCK_AND_ESCALATE'; // Goes to human queue
        requiredApprovers = Math.max(requiredApprovers, res.requiredApprovers || 2);
      } else if (res.action === 'ESCALATE' && decisionType !== 'REJECT_AND_REPLAN') {
        decisionType = 'BLOCK_AND_ESCALATE';
      } else if (res.action === 'INJECT_CONSTRAINT') {
        if (decisionType === 'APPROVE') decisionType = 'APPROVE_WITH_CONSTRAINTS';
        combinedConstraints = { ...combinedConstraints, ...res.injectedConstraints };
      }
    }

    // Phase 2: Capability Escalation Guard
    if (decisionType.startsWith('APPROVE') && capability.requiresHumanReview) {
         decisionType = 'BLOCK_AND_ESCALATE';
         logger.info(`[Covernor] Upgrading decision to ESCALATE because Capability '${capability.id}' strictly requires Human Review.`);
    }

    // ------------------------------------------------------------------
    // V2 Financial Generation: Velocity and Anomaly Controls
    // Deterministically count action limits over sliding time windows
    // ------------------------------------------------------------------
    if (recommendedOption.actionType === 'TRANSFER_FUNDS' && decisionType !== 'REJECT_AND_REPLAN') {
       try {
           // Dimension 1: Tenant-level action velocity (e.g. Max 5 transfers per hour)
           const velocityKey = `velocity:${proposal.tenantId}:${recommendedOption.actionType}`;
           
           // P1.3 Use atomic Lua script to prevent INCR/EXPIRE race condition where key never expires
           const luaScript = `
              local current = redis.call('INCR', KEYS[1])
              if current == 1 then
                  redis.call('EXPIRE', KEYS[1], ARGV[1])
              end
              return current
           `;
           const currentCount = await redisClient.eval(luaScript, 1, velocityKey, 3600) as number;

           const TENANT_VELOCITY_LIMIT = 5; 
           if (currentCount > TENANT_VELOCITY_LIMIT) {
              logger.warn(`[Covernor] ${proposal.tenantId} exceeded Velocity Limit for ${recommendedOption.actionType}. Shield active.`);
              decisionType = 'BLOCK_AND_ESCALATE';
              highestRisk = 'CRITICAL';
              const reason = {
                  policyId: 'v2_velocity_guard_tenant',
                  passed: false,
                  action: 'ESCALATE',
                  reason: `Tenant velocity limit exceeded. Allowed ${TENANT_VELOCITY_LIMIT} / hour. Blocked attempt #${currentCount}.`,
                  riskAssigned: 'CRITICAL'
              };
              formattedResults['v2_velocity_guard_tenant'] = reason;
              policyResults.push(reason as any);
           }

           // Dimension 2: Recipient-level velocity (e.g. Max 2 transfers to same user per day)
           const recipient = recommendedOption.parameters?.recipient;
           if (recipient) {
               const recipientKey = `velocity:${proposal.tenantId}:recipient:${recipient}`;
               const recipientCount = await redisClient.eval(luaScript, 1, recipientKey, 86400) as number;
               
               const RECIPIENT_VELOCITY_LIMIT = 2; 
               if (recipientCount > RECIPIENT_VELOCITY_LIMIT) {
                  logger.warn(`[Covernor] ${proposal.tenantId} exceeded Recipient Velocity Limit for ${recipient}.`);
                  decisionType = 'BLOCK_AND_ESCALATE';
                  highestRisk = 'CRITICAL';
                  const reason = {
                      policyId: 'v2_velocity_guard_recipient',
                      passed: false,
                      action: 'ESCALATE',
                      reason: `Recipient velocity limit exceeded. Allowed ${RECIPIENT_VELOCITY_LIMIT} payouts / day to ${recipient}. Blocked attempt #${recipientCount}.`,
                      riskAssigned: 'CRITICAL'
                  };
                  formattedResults['v2_velocity_guard_recipient'] = reason;
                  policyResults.push(reason as any);
               }
           }
       } catch (redisError: any) {
           logger.error(`[Covernor] INFRASTRUCTURE ALERT: Redis Velocity Cache Unavailable. Failing Closed for ${recommendedOption.actionType}.`, { error: redisError.message });
           decisionType = 'BLOCK_AND_ESCALATE';
           highestRisk = 'CRITICAL';
           const reason = {
               policyId: 'v2_velocity_guard_unavailable',
               passed: false,
               action: 'ESCALATE',
               reason: `Safety Systems Degraded: Redis is unreachable. Financial execution is blocked until velocity controls are restored.`,
               riskAssigned: 'CRITICAL'
           };
           formattedResults['v2_velocity_guard_unavailable'] = reason;
           policyResults.push(reason as any);
       }
    }

    // TODO: In a production system, if the primary is rejected, the Covernor should 
    // evaluate the proposal.fallbackOptions array before outright rejecting.

    const finalConstraints = Object.keys(combinedConstraints).length > 0 ? combinedConstraints : undefined;

    // To link the decision properly, we generate deterministic IDs for the token
    const decisionId = uuidv4();
    const nonce = uuidv4();
    
    // Recompute exact hash with real IDs
    const finalHash = KMSService.generatePayloadHash(
       proposal.tenantId, proposal.taskId, proposal.id, decisionId, recommendedOption, nonce
    );

    const tokenPayload: ApprovalTokenPayload = {
      version: "1",
      decisionId: decisionId,
      tenantId: proposal.tenantId,
      taskId: proposal.taskId,
      proposalId: proposal.id,
      operator: recommendedOption.actionType, // The contract operator
      allowedActions: [recommendedOption.actionType],
      payloadHash: finalHash,
      scope: {
         capabilityIds: [capability.id], // Hardened to use Registry ID instead of raw tool name
      },
      nonce,
      expiresAt: Date.now() + (1000 * 60 * 15) // 15 minutes expiry for hardened capability tokens
    };

    let signature = "";
    if (decisionType.startsWith('APPROVE')) {
         signature = KMSService.signToken(tokenPayload);
    }

    const decision = await prisma.decision.create({
      data: {
        id: decisionId,
        tenantId: proposal.tenantId,
        proposalId,
        decisionType,
        riskLevel: highestRisk,
        policyResults: formattedResults,
        constraints: finalConstraints,
        approvedPayloadHash: finalHash,
        requiredApprovers,
        approvalsCount: 0
      },
    });

    if (signature) {
      await prisma.approvalToken.create({
        data: {
           nonce: tokenPayload.nonce,
           decisionId: tokenPayload.decisionId,
           tenantId: tokenPayload.tenantId,
           taskId: tokenPayload.taskId,
           proposalId: tokenPayload.proposalId,
           payloadHash: tokenPayload.payloadHash,
           signature: signature,
           expiresAt: new Date(tokenPayload.expiresAt),
           policyVersionHash: versionHash
        }
      });
    }

    await prisma.proposal.update({
      where: { id: proposalId },
      data: { status: decisionType.startsWith('APPROVE') ? 'APPROVED' : (decisionType === 'REJECT_AND_REPLAN' ? 'REJECTED' : 'PENDING_REVIEW') },
    });

    await AuditLogger.logAction({
      proposalId,
      decisionId: decision.id,
      actionDetails: {
        actor: 'Covernor',
        action: 'evaluate_proposal',
        decision: decisionType,
        riskLevel: highestRisk,
        appliedConstraints: finalConstraints
      },
      policyVersion: versionHash
    });

    if (decisionType === 'REJECT_AND_REPLAN') {
      const rejectReason = policyResults.find((r: any) => r.action === 'REJECT');
      const reasonMsg = rejectReason?.reason || 'Policy Violation';
      const alternative = rejectReason?.suggestedAlternative;
      throw new GovernorRejectionError(proposalId, reasonMsg, alternative);
    }

    if (decisionType === 'BLOCK_AND_ESCALATE') {
      const escalateReason = policyResults.find((r: any) => r.action === 'ESCALATE' || r.action === 'REQUIRE_DUAL_APPROVAL');
      const reasonMsg = escalateReason?.reason || 'Requires Human Review';
      throw new GovernorEscalationError(proposalId, reasonMsg);
    }

    return decision;
  }
}
