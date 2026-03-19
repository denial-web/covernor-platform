import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import crypto from 'crypto';

export const requireAdminAuth = (req: Request, res: Response, next: NextFunction) => {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
      return res.status(400).json({ error: 'Bad Request: x-tenant-id header is required.' });
  }

  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
      return res.status(400).json({ error: 'Bad Request: x-user-id header is required.' });
  }

  const apiKey = req.headers['x-api-key'] as string | undefined;
  // Look for a tenant-specific API key first, then fallback to global ADMIN_API_KEY
  const expectedApiKey = process.env[`API_KEY_${tenantId}`] || process.env.ADMIN_API_KEY;

  if (!expectedApiKey) {
     logger.error('[Auth Middleware] Critical Failure: No API Key configured for tenant or globally.');
     return res.status(500).json({ error: 'Internal Server Config Error' });
  }

  let isValid = false;
  if (apiKey) {
      const a = Buffer.from(apiKey);
      const b = Buffer.from(expectedApiKey);
      if (a.length === b.length) {
          isValid = crypto.timingSafeEqual(a, b);
      }
  }

  if (!isValid) {
     logger.warn(`[Auth Middleware] Unauthorized access attempt for tenant ${tenantId} from IP: ${req.ip}`);
     return res.status(401).json({ error: 'Unauthorized: Invalid API Key for Tenant' });
  }
  
  next();
};
