import axios from 'axios';
import { z } from 'zod';
import { BaseToolAdapter, ToolResult, ToolContext } from './base.tool';
import { OperatorContract } from '../operator.types';
import { logger } from '../../../utils/logger';

export class SlackOperator implements BaseToolAdapter {
  actionType = "SLACK_OPERATOR";
  contract: OperatorContract = {
    maxExecutionTimeMs: 5000,
    maxRowsAffected: 1,
    requiresIdempotencyKey: false,
    rollbackEnabled: false,
    rateLimitPerMinute: 30,
    allowedParameterSchema: z.object({
      webhookUrl: z.string().url().regex(/^https:\/\/hooks\.slack\.com\/services\//, "Must be a valid Slack webhook URL"),
      message: z.string().min(1),
      channel: z.string().optional()
    })
  };

  constructor() {}

  async execute(parameters: any, context?: ToolContext): Promise<ToolResult> {
    const { webhookUrl, message, channel } = parameters;

    if (!webhookUrl || !message) {
      throw new Error("Missing required parameters: 'webhookUrl', 'message'");
    }
    
    // Security check: Only allow safe webhook URLs (e.g., hooks.slack.com)
    if (!webhookUrl.startsWith('https://hooks.slack.com/services/')) {
        throw new Error("Security Violation: Slack webhook URL must start with 'https://hooks.slack.com/services/'");
    }

    try {
      const payload: any = { text: message };
      if (channel) payload.channel = channel;

      logger.info(`[SlackOperator] Sending message to Slack...`);
      
      const response = await axios.post(webhookUrl, payload, {
          signal: context?.abortSignal // Abort if timeout reached
      });

      logger.info(`[SlackOperator] Successfully posted to Slack: ${response.status}`);

      return {
        status: 'SUCCESS',
        completedSteps: ['validate_url', 'post_webhook'],
        rollbackAvailable: false
      };

    } catch (error: any) {
      logger.error(`[SlackOperator] Failed to post to Slack`, { error: error.message });
      throw error;
    }
  }

  async rollback(originalParameters: any, context?: any) {
    // Cannot natively "unsend" a generic webhook easily without API auth
    logger.warn('[SlackOperator] Rollback is not supported for Slack notifications.');
    return false;
  }
}
