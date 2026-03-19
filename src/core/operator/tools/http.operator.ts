import axios, { AxiosRequestConfig } from 'axios';
import { BaseToolAdapter, ToolContext, ToolResult } from './base.tool';
import { OperatorContract } from '../operator.types';

export class HTTPOperator implements BaseToolAdapter {
  actionType = 'HTTP_REQUEST';

  contract: OperatorContract = {
    maxExecutionTimeMs: 10000, // 10s max HTTP fetch
    maxRowsAffected: 0,        // N/A for HTTP
    requiresIdempotencyKey: false,
    rollbackEnabled: false,
    rateLimitPerMinute: 60
  };

  async execute(parameters: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const { url, method, headers, data } = parameters;
    
    if (!url || typeof url !== 'string') {
      return {
        status: 'FAILED',
        completedSteps: ['initialize'],
        failedStep: 'validate_parameters',
        failureCode: 'MISSING_URL',
        rollbackAvailable: false
      };
    }

    try {
      const parsedUrl = new URL(url);
      
      // 1. SSRF Protect: Enforce HTTPS
      if (parsedUrl.protocol !== 'https:') {
        throw new Error('SSRF_GUARD: Only HTTPS URLs are allowed.');
      }

      // 2. SSRF Protect: Disallow IPs and local hostnames
      const hostname = parsedUrl.hostname.toLowerCase();
      const forbiddenHostnames = ['localhost', '127.0.0.1', '169.254.169.254', '0.0.0.0', '[::1]'];
      if (forbiddenHostnames.includes(hostname)) {
         throw new Error('SSRF_GUARD: Localhost and metadata URLs are forbidden.');
      }
      if (hostname.startsWith('10.') || hostname.startsWith('192.168.') || hostname.match(/^172\.(1[6-9]|2\d|3[0-1])\./)) {
         throw new Error('SSRF_GUARD: Internal network IPs are forbidden.');
      }

      // 3. SSRF Protect: Explicit Allowlist (if configured)
      const allowlistRaw = process.env.TARGET_URL_ALLOWLIST;
      if (allowlistRaw) {
        const allowedHosts = allowlistRaw.split(',').map(h => h.trim().toLowerCase());
        if (!allowedHosts.includes(hostname)) {
          throw new Error(`SSRF_GUARD: Hostname '${hostname}' is not in the TARGET_URL_ALLOWLIST.`);
        }
      }

      const config: AxiosRequestConfig = {
        url,
        method: method || 'GET',
        headers: headers || {},
        data,
        timeout: this.contract.maxExecutionTimeMs, // Map the contract bounds
        maxRedirects: 0 // SSRF_GUARD: Disable automatic redirects to prevent secondary SSRF targets
      };

      // Check for AbortSignal injected by Operator Service
      if (context.abortSignal) {
         config.signal = context.abortSignal;
      }

      const response = await axios(config);

      return {
        status: 'SUCCESS',
        completedSteps: ['initialize', 'validate_parameters', 'execute_http_request'],
        rollbackAvailable: false,
        data: {
            status: response.status,
            data: response.data
        }
      };

    } catch (err: any) {
      return {
        status: 'FAILED',
        completedSteps: ['initialize', 'validate_parameters'],
        failedStep: 'execute_http_request',
        failureCode: err.message,
        rollbackAvailable: false
      };
    }
  }
}
