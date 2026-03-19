export interface ToolResult {
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED';
  completedSteps: string[];
  failedStep?: string;
  failureCode?: string;
  errorClassification?: 'FATAL' | 'RETRYABLE' | 'UNKNOWN';
  rollbackAvailable: boolean;
  data?: any; // Useful for passing back providerTransactionId
}

export interface ToolContext {
  constraints?: Record<string, any>; // Injected via Governor
  rollbackActive?: boolean;
  abortSignal?: AbortSignal; // Injected via OperatorContract bounds
  providerIdempotencyKey?: string; // Phase 12 Execution Idempotency
}

import { OperatorContract } from '../operator.types';

export interface BaseToolAdapter {
  actionType: string;
  contract: OperatorContract;
  execute(parameters: Record<string, any>, context: ToolContext): Promise<ToolResult>;
  rollback?(parameters: Record<string, any>, context: ToolContext): Promise<boolean>;
}
