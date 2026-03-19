import { ZodTypeAny } from 'zod';

/**
 * Defines the strict execution boundaries and capabilities for an individual Operator tool.
 * Evaluated by the OperatorService before, during, and after execution.
 */
export interface OperatorContract {
    /** 
     * Maximum allowed execution time in milliseconds. 
     * If the execution exceeds this time, the process is aborted with an error. 
     */
    maxExecutionTimeMs: number;
    
    /** 
     * Maximum number of rows/records the operation is permitted to mutate or access. 
     * This acts as a circuit breaker for unconstrained bulk operations.
     */
    maxRowsAffected: number;
    
    /** 
     * If true, the caller must supply an idempotency key to prevent double execution. 
     */
    requiresIdempotencyKey: boolean;
    
    /** 
     * If true, the operator MUST expose an explicit `rollback` mechanism that can 
     * undo the operation if a downstream error occurs. 
     */
    rollbackEnabled: boolean;
    
    /** 
     * Rate limit controls how many invocations are allowed per minute. 
     * 0 = unlimited. 
     */
    rateLimitPerMinute: number;

    /**
     * Zod schema defining the exact allowed arguments for this specific tool.
     * Enforced by the Governor before approval.
     */
    allowedParameterSchema?: ZodTypeAny;
}

