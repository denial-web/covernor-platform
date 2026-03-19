import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { BaseToolAdapter, ToolResult, ToolContext } from './base.tool';
import { OperatorContract } from '../operator.types';
import { logger } from '../../../utils/logger';

export class FileSystemOperator implements BaseToolAdapter {
  actionType = "FILE_SYSTEM_OPERATOR";
  contract: OperatorContract = {
    maxExecutionTimeMs: 5000,
    maxRowsAffected: 1,
    requiresIdempotencyKey: false,
    rollbackEnabled: true,
    rateLimitPerMinute: 60,
    allowedParameterSchema: z.object({
      operation: z.enum(['READ', 'WRITE']),
      filename: z.string().min(1).max(255).regex(/^[\w\-.]+$/, "Invalid filename. No slashes or directory traversal allowed."),
      content: z.string().max(5 * 1024 * 1024, "Content exceeds 5MB limit.").optional()
    })
  };
  private baseDir: string;

  constructor() {
    // Hardcode the constrained sandbox path relative to root
    this.baseDir = path.resolve(__dirname, 'sandbox');
  }

  /**
   * Safe path resolution to prevent directory traversal attacks (e.g. ../../etc/passwd)
   */
  private async resolveSafePath(filename: string): Promise<string> {
    const safePath = path.resolve(this.baseDir, filename);
    if (!safePath.startsWith(this.baseDir)) {
      throw new Error(`Security Violation: Attempted to access path outside sandbox: ${filename}`);
    }

    try {
        const realPath = await fs.realpath(safePath);
        if (!realPath.startsWith(this.baseDir)) {
           throw new Error(`Security Violation: Symlink resolved outside sandbox: ${filename}`);
        }
        return realPath;
    } catch (e: any) {
        if (e.code === 'ENOENT') {
           // File doesn't exist yet (e.g., during write). Realpath its parent directory.
           const parentDir = path.dirname(safePath);
           const realParent = await fs.realpath(parentDir);
           if (!realParent.startsWith(this.baseDir)) {
               throw new Error(`Security Violation: Symlink directory resolved outside sandbox: ${filename}`);
           }
           return safePath;
        }
        throw e;
    }
  }

  async execute(parameters: any, context?: ToolContext): Promise<ToolResult> {
    const { operation, filename, content } = parameters;

    if (!operation || !filename) {
      throw new Error("Missing required parameters: 'operation', 'filename'");
    }

    try {
      // Ensure sandbox directory exists
      await fs.mkdir(this.baseDir, { recursive: true });

      const safePath = await this.resolveSafePath(filename);

      if (operation === 'WRITE') {
        if (content === undefined) throw new Error("WRITE operation requires 'content' parameter");
        
        // Setup rollback metadata by checking if file existed
        let rollbackData = null;
        try {
          const existing = await fs.readFile(safePath, 'utf-8');
          rollbackData = { operation: 'RESTORE', filename, content: existing };
        } catch {
          rollbackData = { operation: 'DELETE', filename };
        }

        await fs.writeFile(safePath, content, 'utf-8');
        logger.info(`[FileSystemOperator] Wrote to ${filename}`);

        return {
          status: 'SUCCESS',
          completedSteps: ['resolve_path', 'write_file'],
          rollbackAvailable: true,
          data: { rollbackData }
        };

      } else if (operation === 'READ') {
        
        // Priority 3 Security Hardening: Context Window Blowout Protection
        try {
            const stats = await fs.stat(safePath);
            if (stats.size > 5 * 1024 * 1024) { // 5MB limit
               throw new Error(`Security Violation: File size (${stats.size} bytes) exceeds maximum context window size of 5MB.`);
            }
        } catch (e: any) {
            if (e.code === 'ENOENT') throw new Error(`File not found: ${filename}`);
            throw e;
        }

        const fileContent = await fs.readFile(safePath, 'utf-8');
        logger.info(`[FileSystemOperator] Read ${filename}`);

        return {
          status: 'SUCCESS',
          completedSteps: ['resolve_path', 'read_file'],
          rollbackAvailable: false,
          data: { content: fileContent }
        };
      } else {
         throw new Error(`Unsupported operation: ${operation}. Allowed: READ, WRITE.`);
      }

    } catch (error: any) {
      logger.error(`[FileSystemOperator] Error on ${operation} for ${filename}`, { error: error.message });
      throw error;
    }
  }

  async rollback(originalParameters: any, context?: any) {
    const rollbackData = context?.rollbackData;
    if (!rollbackData) return false;

    try {
      const safePath = await this.resolveSafePath(rollbackData.filename);

      if (rollbackData.operation === 'DELETE') {
         await fs.unlink(safePath);
         logger.info(`[FileSystemOperator] Rollback: Deleted ${rollbackData.filename}`);
      } else if (rollbackData.operation === 'RESTORE') {
         await fs.writeFile(safePath, rollbackData.content, 'utf-8');
         logger.info(`[FileSystemOperator] Rollback: Restored ${rollbackData.filename}`);
      }
      return true;
    } catch (error: any) {
      logger.error(`[FileSystemOperator] Rollback failed`, { error: error.message });
      return false;
    }
  }
}
