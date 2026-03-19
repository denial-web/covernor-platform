import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../../../db/client';
import { logger } from '../../../utils/logger';

export interface Policy {
  id: string;
  name: string;
  description: string;
  targetActionTypes: string[];
  ruleType: 'DENY' | 'CONSTRAINT' | 'ESCALATE' | 'DUAL_APPROVAL';
  constraintInjection?: Record<string, any>;
  conditions?: {
    parameter: string;
    operator: 'GREATER_THAN' | 'LESS_THAN' | 'EQUALS' | 'UNTRUSTED_PROVENANCE' | 'CONTAINS';
    value: any;
  };
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface PolicyResult {
  policyId: string;
  passed: boolean;
  action: 'OK' | 'REJECT' | 'ESCALATE' | 'INJECT_CONSTRAINT' | 'REQUIRE_DUAL_APPROVAL';
  reason: string;
  injectedConstraints?: Record<string, any>;
  riskAssigned: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  suggestedAlternative?: string;
  requiredApprovers?: number;
}

export class PolicyEngine {
  /**
   * Evaluates a single action against all loaded policies.
   */
  async evaluateOptions(actionType: string, parameters: Record<string, any> = {}, contextSignals: Record<string, any> = {}): Promise<{ results: PolicyResult[], versionHash: string }> {
    const results: PolicyResult[] = [];
    let loadedPolicies: Policy[] = [];
    let versionHash = 'default-allow-v1';

    // 1. Fetch from Policy Registry
    const activePolicyRec = await prisma.governorPolicy.findFirst({ where: { isActive: true } });

    if (activePolicyRec) {
        loadedPolicies = activePolicyRec.rules as any as Policy[];
        versionHash = activePolicyRec.versionHash;
    } else {
        // 2. Fallback to file system and seed the database
        try {
            const configPath = path.resolve(__dirname, '../../../config/policies.json');
            const file = fs.readFileSync(configPath, 'utf-8');
            const parsed = JSON.parse(file);
            loadedPolicies = parsed.policies || [];
            versionHash = crypto.createHash('sha256').update(file).digest('hex');
            try {
                const existingCount = await prisma.governorPolicy.count();
                if (existingCount === 0) {
                    await prisma.governorPolicy.create({
                        data: {
                            versionHash,
                            rules: loadedPolicies as any,
                            isActive: true
                        }
                    });
                }
            } catch (seedErr) {
               logger.warn("Race condition during policy seed, safe to ignore.", seedErr);
            }
        } catch (err) {
            logger.warn("Could not load policies.json. The Covernor will default to pass-through.", err);
        }
    }

    const applicablePolicies = loadedPolicies.filter(p => 
      p.targetActionTypes.includes(actionType) || p.targetActionTypes.includes('*')
    );

    if (applicablePolicies.length === 0) {
      results.push({
        policyId: 'DEFAULT_ALLOW',
        passed: true,
        action: 'OK',
        reason: 'No restrictions apply to this action.',
        riskAssigned: 'LOW'
      });
      return { results, versionHash };
    }

    for (const policy of applicablePolicies) {
      
      // Check condition logic (e.g., amount > 500)
      let conditionMet = true;
      if (policy.conditions) {
        const paramValue = parameters[policy.conditions.parameter];
        if (paramValue === undefined) {
          conditionMet = false;
        } else {
          switch (policy.conditions.operator) {
            case 'GREATER_THAN': conditionMet = paramValue > policy.conditions.value; break;
            case 'LESS_THAN': conditionMet = paramValue < policy.conditions.value; break;
            case 'EQUALS': conditionMet = paramValue === policy.conditions.value; break;
            case 'UNTRUSTED_PROVENANCE': {
               const paramProvenance = contextSignals?.provenance?.[policy.conditions.parameter];
               // Condition triggers if provenance does NOT match the required trusted value
               conditionMet = paramProvenance !== policy.conditions.value;
               break;
            }
            case 'CONTAINS': {
                if (typeof paramValue === 'string' && Array.isArray(policy.conditions.value)) {
                    conditionMet = policy.conditions.value.some(val => paramValue.toUpperCase().includes(String(val).toUpperCase()));
                } else if (Array.isArray(paramValue)) {
                    conditionMet = paramValue.includes(policy.conditions.value);
                } else {
                    conditionMet = String(paramValue).includes(String(policy.conditions.value));
                }
                break;
            }
          }
        }
      }

      if (!conditionMet && policy.conditions) {
        // Condition wasn't triggered, rule doesn't apply
        continue;
      }

      if (policy.ruleType === 'DENY') {
        const altMsg = policy.conditions 
            ? `Consider revising so ${policy.conditions.parameter} complies with the threshold value of ${policy.conditions.value}.` 
            : 'No generic alternative available. This action is permanently blocked.';
            
        results.push({
          policyId: policy.id,
          passed: false,
          action: 'REJECT',
          reason: `Violates rule: ${policy.description}`,
          suggestedAlternative: altMsg,
          riskAssigned: policy.riskLevel
        });
      } else if (policy.ruleType === 'ESCALATE') {
         results.push({
          policyId: policy.id,
          passed: false,
          action: 'ESCALATE',
          reason: `Escalation required: ${policy.description}`,
          riskAssigned: policy.riskLevel
        });
      } else if (policy.ruleType === 'CONSTRAINT') {
        results.push({
          policyId: policy.id,
          passed: true,
          action: 'INJECT_CONSTRAINT',
          reason: `Constraint required: ${policy.description}`,
          injectedConstraints: policy.constraintInjection,
          riskAssigned: policy.riskLevel
        });
      } else if (policy.ruleType === 'DUAL_APPROVAL') {
        results.push({
          policyId: policy.id,
          passed: false,
          action: 'REQUIRE_DUAL_APPROVAL',
          reason: `Dual Approval required: ${policy.description}`,
          riskAssigned: policy.riskLevel,
          requiredApprovers: 2
        });
      }
    }

    return { results, versionHash };
  }
}
