import { Client } from 'pg';
import { BaseToolAdapter, ToolContext, ToolResult } from './base.tool';
import { OperatorContract } from '../operator.types';

export class PostgreSQLOperator implements BaseToolAdapter {
  actionType = 'POSTGRESQL_QUERY';

  contract: OperatorContract = {
    maxExecutionTimeMs: 15000, // 15s max query
    maxRowsAffected: 1000,     // strict max return/mutate size
    requiresIdempotencyKey: false,
    rollbackEnabled: false,    // Custom impl could enable transcactions
    rateLimitPerMinute: 120
  };

  async execute(parameters: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const { query, values } = parameters;
    
    if (!query || typeof query !== 'string') {
      return {
        status: 'FAILED',
        completedSteps: ['initialize'],
        failedStep: 'validate_parameters',
        failureCode: 'INVALID_QUERY_FORMAT',
        rollbackAvailable: false
      };
    }

    // 1. SQL Injection & Privilege Guard: Enforce Read-Only Operations
    const normalizedQuery = query.trim().toUpperCase();
    if (!normalizedQuery.startsWith('SELECT')) {
      return {
        status: 'FAILED',
        completedSteps: ['initialize'],
        failedStep: 'validate_parameters',
        failureCode: 'SQL_GUARD_VIOLATION: Only SELECT queries are permitted.',
        rollbackAvailable: false
      };
    }

    // Block stacked queries / multiple statements
    if (query.includes(';')) {
      const parts = query.split(';').map(p => p.trim()).filter(p => p.length > 0);
      if (parts.length > 1) {
         return {
          status: 'FAILED',
          completedSteps: ['initialize'],
          failedStep: 'validate_parameters',
          failureCode: 'SQL_GUARD_VIOLATION: Stacked queries are prohibited.',
          rollbackAvailable: false
        };
      }
    }

    // Block explicit destructive or administrative verbs anywhere in the statement
    const forbiddenKeywords = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'GRANT', 'REVOKE', 'EXEC', 'COPY'];
    for (const keyword of forbiddenKeywords) {
      // Basic word boundary regex to avoid false positives on column names like "update_time"
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(query)) {
        return {
          status: 'FAILED',
          completedSteps: ['initialize'],
          failedStep: 'validate_parameters',
          failureCode: `SQL_GUARD_VIOLATION: Forbidden keyword '${keyword}' detected in read-only context.`,
          rollbackAvailable: false
        };
      }
    }

    // Connect using environment default connection
    const client = new Client({ connectionString: process.env.DATABASE_URL });

    try {
      await client.connect();

      // Check for AbortSignal injected by the OperatorService contract boundary
      if (context.abortSignal) {
        context.abortSignal.addEventListener('abort', () => {
             client.end().catch(()=>null); // Force connection death
        });
      }

      // 2. Defense-in-depth: Enforce row limits using LIMIT in SQL before execution
      let finalQuery = query.trim();
      const limitMatch = finalQuery.match(/LIMIT\s+(\d+)/i);
      if (limitMatch) {
         const userLimit = parseInt(limitMatch[1], 10);
         if (userLimit > this.contract.maxRowsAffected) {
            finalQuery = finalQuery.replace(new RegExp(`LIMIT\\s+${userLimit}`, 'i'), `LIMIT ${this.contract.maxRowsAffected}`);
         }
      } else {
         finalQuery = `${finalQuery} LIMIT ${this.contract.maxRowsAffected}`;
      }

      const res = await client.query(finalQuery, values || []);
      
      // Enforce the Contract bounded rows limits dynamically post-execution (fallback)
      if (res.rowCount && res.rowCount > this.contract.maxRowsAffected) {
          throw new Error(`Execution exceeded maxRowsAffected threshold. Limit: ${this.contract.maxRowsAffected}, Actual: ${res.rowCount}`);
      }

      await client.end();

      return {
        status: 'SUCCESS',
        completedSteps: ['initialize', 'validate_parameters', 'execute_postgres_query'],
        rollbackAvailable: false,
        data: res.rows
      };

    } catch (err: any) {
      await client.end().catch(()=>null);
      return {
        status: 'FAILED',
        completedSteps: ['initialize', 'validate_parameters'],
        failedStep: 'execute_postgres_query',
        failureCode: err.message,
        rollbackAvailable: false
      };
    }
  }
}
