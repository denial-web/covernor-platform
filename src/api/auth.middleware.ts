import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/client';

export type UserRole = 'admin' | 'approver' | 'viewer' | 'operator';

export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

function getJWTSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CRITICAL: JWT_SECRET environment variable is required in production.');
    }
    return process.env.ADMIN_API_KEY || 'dev-only-jwt-secret-not-for-production';
  }
  return secret;
}

/**
 * Issues a JWT for a verified user.
 */
export function issueToken(userId: string, tenantId: string, role: UserRole): string {
  return jwt.sign({ userId, tenantId, role }, getJWTSecret(), { expiresIn: '8h' });
}

/**
 * Primary auth middleware. Supports two modes:
 * 1. JWT Bearer token (production) — cryptographically verified identity
 * 2. API key + headers (development/backward compat) — role looked up from DB
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'] as string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    return authenticateJWT(req, res, next, authHeader.slice(7));
  }

  return authenticateAPIKey(req, res, next);
};

function authenticateJWT(req: Request, res: Response, next: NextFunction, token: string) {
  try {
    const decoded = jwt.verify(token, getJWTSecret()) as AuthenticatedUser;
    if (!decoded.userId || !decoded.tenantId || !decoded.role) {
      return res.status(401).json({ error: 'Malformed JWT: missing required claims.' });
    }
    req.user = {
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      role: decoded.role,
    };
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'JWT expired. Please re-authenticate.' });
    }
    logger.warn('[Auth] Invalid JWT presented', { error: err.message });
    return res.status(401).json({ error: 'Invalid authentication token.' });
  }
}

async function authenticateAPIKey(req: Request, res: Response, next: NextFunction) {
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId) {
    return res.status(400).json({ error: 'Bad Request: x-tenant-id header is required.' });
  }

  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    return res.status(400).json({ error: 'Bad Request: x-user-id header is required.' });
  }

  const apiKey = req.headers['x-api-key'] as string | undefined;
  const expectedApiKey = process.env[`API_KEY_${tenantId}`] || process.env.ADMIN_API_KEY;

  if (!expectedApiKey) {
    logger.error('[Auth] Critical: No API Key configured for tenant or globally.');
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
    logger.warn(`[Auth] Unauthorized access attempt for tenant ${tenantId} from IP: ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key for Tenant' });
  }

  const role = await resolveUserRole(tenantId, userId);
  req.user = { userId, tenantId, role };
  next();
}

/**
 * Resolves a user's role from the database. Falls back to 'viewer' if not found.
 * In dev mode, the first user for a tenant is auto-provisioned as 'admin'.
 */
async function resolveUserRole(tenantId: string, userId: string): Promise<UserRole> {
  try {
    const record = await prisma.userRole.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });

    if (record) {
      const validRoles: UserRole[] = ['admin', 'approver', 'viewer', 'operator'];
      return validRoles.includes(record.role as UserRole) ? (record.role as UserRole) : 'viewer';
    }

    if (process.env.NODE_ENV !== 'production') {
      const existingCount = await prisma.userRole.count({ where: { tenantId } });
      const assignedRole: UserRole = existingCount === 0 ? 'admin' : 'viewer';
      await prisma.userRole.create({
        data: { tenantId, userId, role: assignedRole },
      });
      logger.info(`[Auth] Auto-provisioned user ${userId} as '${assignedRole}' for tenant ${tenantId}`);
      return assignedRole;
    }

    return 'viewer';
  } catch (err: any) {
    logger.warn(`[Auth] Failed to resolve role for ${userId}, defaulting to viewer`, { error: err.message });
    return 'viewer';
  }
}

/**
 * Role gate factory. Returns middleware that blocks unless user has an allowed role.
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      logger.warn(`[RBAC] User ${req.user.userId} with role '${req.user.role}' denied. Required: ${allowedRoles.join(', ')}`);
      return res.status(403).json({
        error: `Forbidden: Requires [${allowedRoles.join(', ')}] role. Your role: '${req.user.role}'.`,
      });
    }
    next();
  };
}

/**
 * Login endpoint. Validates API key, looks up role from DB, issues JWT.
 */
export const loginHandler = async (req: Request, res: Response) => {
  const { tenantId, userId } = req.body;
  const apiKey = req.headers['x-api-key'] as string | undefined;

  if (!tenantId || !userId) {
    return res.status(400).json({ error: 'tenantId and userId are required.' });
  }

  const expectedApiKey = process.env[`API_KEY_${tenantId}`] || process.env.ADMIN_API_KEY;
  if (!expectedApiKey || !apiKey) {
    return res.status(401).json({ error: 'API key required for authentication.' });
  }

  const a = Buffer.from(apiKey);
  const b = Buffer.from(expectedApiKey);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Invalid API key.' });
  }

  const role = await resolveUserRole(tenantId, userId);
  const token = issueToken(userId, tenantId, role);

  res.json({ token, expiresIn: '8h', role });
};

export const requireAdminAuth = requireAuth;
