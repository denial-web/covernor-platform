import { Proposal } from '@prisma/client';
import { logger } from '../../utils/logger';

export interface StructCriticResponse {
  isValid: boolean;
  reasonCode: 'APPROVED' | 'HALLUCINATED_TOOL' | 'MISSING_PARAMETERS' | 'VIOLATES_SYSTEM_INSTRUCTIONS' | 'EXCESSIVE_RISK';
  confidence: number;
}

export class CriticService {
  /**
   * Evaluates an Advisor's proposal before it reaches the Covernor.
   * In a production environment, this would call a fast/cheap LLM (e.g., GPT-3.5-Turbo)
   * to catch obvious hallucinations or formatting errors.
   */
  async evaluate(proposal: Proposal, objective: string): Promise<StructCriticResponse> {
    logger.info(`[Critic] Evaluating Proposal ID: ${proposal.id} for Objective: "${objective}"`);

    // Mock Critic Logic
    const recOpt = proposal.recommendedOption as any;
    
    // E.g., If the payload is completely empty, it's an obvious hallucination.
    if (!recOpt || !recOpt.parameters || Object.keys(recOpt.parameters).length === 0) {
      return {
        isValid: false,
        reasonCode: 'MISSING_PARAMETERS',
        confidence: 0.95
      };
    }

    // E.g., If the Advisor hallucinates an actionType that doesn't exist
    const validActionTypes = ['READ_DATABASE', 'MODIFY_DATABASE', 'TRANSFER_FUNDS', 'HTTP_REQUEST', 'FILE_SYSTEM_OPERATOR', 'SLACK_OPERATOR', 'ZENDESK_OPERATOR', 'POSTGRESQL_QUERY'];
    if (!validActionTypes.includes(recOpt.actionType)) {
      return {
        isValid: false,
        reasonCode: 'HALLUCINATED_TOOL',
        confidence: 0.99
      };
    }

    // If it passes basic sanity checks, the Critic approves it for the Covernor.
    return { 
        isValid: true,
        reasonCode: 'APPROVED',
        confidence: 0.90
    };
  }
}
