import { BaseToolAdapter, ToolContext, ToolResult } from './base.tool';
import { OperatorContract } from '../operator.types';
import { logger } from '../../../utils/logger';

export class TransferFundsOperator implements BaseToolAdapter {
  actionType = 'TRANSFER_FUNDS';
  contract: OperatorContract = {
      maxExecutionTimeMs: 10000,
      maxRowsAffected: 0,
      requiresIdempotencyKey: true,
      rollbackEnabled: true,
      rateLimitPerMinute: 10
  };

  async execute(parameters: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const { amount, recipient } = parameters;
    
    // Explicit Constraint Check
    const maxAmount = context.constraints?.maxAmount ?? Infinity;

    if (!amount || !recipient) {
      return {
        status: 'FAILED',
        completedSteps: ['initialize'],
        failedStep: 'validate_parameters',
        failureCode: 'MISSING_PARAMETERS',
        rollbackAvailable: false
      };
    }

    if (amount > maxAmount) {
         return {
            status: 'FAILED',
            completedSteps: ['initialize', 'validate_parameters'],
            failedStep: 'check_constraints',
            failureCode: 'EXCEEDS_MAX_AMOUNT',
            errorClassification: 'FATAL',
            rollbackAvailable: false
         };
    }

    // ------------------------------------------------------------------
    // V2 Financial: Execution-Time Live Authorization Recheck
    // ------------------------------------------------------------------
    // Mocking an internal API call indicating if the user got banned 
    // *between* the time the Governor approved this and now.
    const isAccountLocked = false; 

    if (isAccountLocked) {
        return {
           status: 'FAILED',
           completedSteps: ['initialize', 'validate_parameters', 'check_constraints'],
           failedStep: 'live_authorization_recheck',
           failureCode: 'ACCOUNT_BANNED_POST_APPROVAL',
           errorClassification: 'FATAL',
           rollbackAvailable: false
        };
    }

    // ------------------------------------------------------------------
    // V2 Financial: External Payment API Safety Patterns
    // ------------------------------------------------------------------
    const currentBalance = 50000; // Mock external pre-flight balance check
    
    if (amount > currentBalance) {
         return {
           status: 'FAILED',
           completedSteps: ['initialize', 'validate_parameters', 'check_constraints', 'live_authorization_recheck'],
           failedStep: 'pre_flight_balance_check',
           failureCode: 'INSUFFICIENT_FUNDS_AT_EXECUTION',
           errorClassification: 'FATAL',
           rollbackAvailable: false
         };
    }

    try {
      // MOCK: In the real world, this would call a payment gateway
      // definitively passing `context.providerIdempotencyKey`.
      // If the provider accepts the key, we assume transaction succeeded.
      
      // MOCK POST-SUCCESS CONFIRMATION
      // const confirmation = await gateway.getTransaction(context.providerIdempotencyKey);
      
      return {
        status: 'SUCCESS',
        completedSteps: ['initialize', 'validate_parameters', 'check_constraints', 'live_authorization_recheck', 'pre_flight_balance_check', 'execute_transfer', 'post_flight_confirmation'],
        rollbackAvailable: true,
        data: { transactionId: 'txn_' + Date.now() + '_' + context.providerIdempotencyKey }
      };
    } catch (err: any) {
      return {
        status: 'FAILED',
        completedSteps: ['initialize', 'validate_parameters', 'check_constraints', 'live_authorization_recheck', 'pre_flight_balance_check'],
        failedStep: 'execute_transfer',
        failureCode: err.message,
        errorClassification: 'UNKNOWN', // Emulate an external network crash during payment flow
        rollbackAvailable: false
      };
    }
  }

  async rollback(parameters: Record<string, any>, context: ToolContext): Promise<boolean> {
       // Mock refund logic
       logger.info(`[TransferFundsOperator] Rolling back transfer of ${parameters.amount} to ${parameters.recipient}`);
       return true;
  }
}
