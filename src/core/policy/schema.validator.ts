import { z } from 'zod';
import { logger } from '../../utils/logger';

// Hard boundary: Every LLM output MUST match this structural signature.
export const BaseProposalSchema = z.object({
  actionType: z.enum([
    'READ_DATABASE', 
    'MODIFY_DATABASE', 
    'TRANSFER_FUNDS', 
    'HTTP_REQUEST', 
    'FILE_SYSTEM_OPERATOR', 
    'SLACK_OPERATOR', 
    'ZENDESK_OPERATOR',
    'POSTGRESQL_QUERY'
  ]),
  parameters: z.record(z.string(), z.any()), // Further restricted by Operator Contracts later
  riskEstimate: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional()
});

// v1.2 Hardening: The Critic must only output this exact structure.
// No free-text allowed to prevent soft-prompt-injection channels.
export const CriticOutputSchema = z.object({
  isValid: z.boolean(),
  reasonCode: z.enum([
    'APPROVED',
    'HALLUCINATED_TOOL',
    'MISSING_PARAMETERS',
    'VIOLATES_SYSTEM_INSTRUCTIONS',
    'EXCESSIVE_RISK'
  ]),
  confidence: z.number().min(0).max(1)
});

export class SchemaValidator {
  /**
   * Deterministically validates the Minister's raw LLM JSON payload.
   * If it fails Zod parse, it throws immediately.
   */
  static validateProposalPayload(payload: any) {
    try {
      return BaseProposalSchema.parse(payload);
    } catch (error: any) {
      logger.error(`[SchemaValidator] Hard structural rejection:`, { issues: error.issues });
      throw new Error(`Structural Invalidity: LLM Payload failed JSON Schema validation. ${error.message}`);
    }
  }

  /**
   * Deterministically validates the Critic's LLM output.
   */
  static validateCriticPayload(payload: any) {
    try {
      return CriticOutputSchema.parse(payload);
    } catch (error: any) {
      logger.error(`[SchemaValidator] Critic Schema Violation:`, { issues: error.issues });
      throw new Error(`Structural Invalidity: Critic LLM Output failed JSON Schema validation. ${error.message}`);
    }
  }
}
