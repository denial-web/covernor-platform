import { BaseToolAdapter, ToolResult, ToolContext } from './base.tool';
import { OperatorContract } from '../operator.types';
import { logger } from '../../../utils/logger';

export class ZendeskOperator implements BaseToolAdapter {
  actionType = "ZENDESK_OPERATOR";
  contract: OperatorContract = {
    maxExecutionTimeMs: 3000,
    maxRowsAffected: 1,
    requiresIdempotencyKey: false,
    rollbackEnabled: false,
    rateLimitPerMinute: 100
  };

  constructor() {}

  async execute(parameters: any, context?: ToolContext): Promise<ToolResult> {
    const { operation, subject, description, priority } = parameters;

    if (!operation) {
      throw new Error("Missing required parameter: 'operation' (CREATE, RESOLVE)");
    }

    try {
      if (operation === 'CREATE') {
        if (!subject || !description) throw new Error("CREATE requires 'subject' and 'description'");
        
        // Mock network delay
        await new Promise(resolve => setTimeout(resolve, 800));
        
        const mockTicketId = `ZD-${Math.floor(Math.random() * 100000)}`;
        logger.info(`[ZendeskOperator] Mock Created Ticket ${mockTicketId}: ${subject}`);

        return {
          status: 'SUCCESS',
          completedSteps: ['validate_payload', 'mock_api_create'],
          rollbackAvailable: false,
          data: { ticketId: mockTicketId }
        };

      } else if (operation === 'RESOLVE') {
        const { ticketId } = parameters;
        if (!ticketId) throw new Error("RESOLVE requires 'ticketId'");

        await new Promise(resolve => setTimeout(resolve, 500));
        logger.info(`[ZendeskOperator] Mock Resolved Ticket ${ticketId}`);

        return {
          status: 'SUCCESS',
          completedSteps: ['validate_payload', 'mock_api_resolve'],
          rollbackAvailable: false
        };
      } else {
         throw new Error(`Unsupported operation: ${operation}. Allowed: CREATE, RESOLVE.`);
      }

    } catch (error: any) {
      logger.error(`[ZendeskOperator] Error on ${operation}`, { error: error.message });
      throw error;
    }
  }

  async rollback(originalParameters: any, context?: any) {
    logger.warn('[ZendeskOperator] Rollback is not supported in this mock implementation.');
    return false;
  }
}
