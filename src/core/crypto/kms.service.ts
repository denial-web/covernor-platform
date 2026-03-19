import * as crypto from 'crypto';
import { prisma } from '../../db/client';
import { logger } from '../../utils/logger';

export type ApprovalTokenPayload = {
  version: "1";
  decisionId: string;
  tenantId: string;
  taskId: string;
  proposalId: string;
  operator: string;
  allowedActions: string[];
  payloadHash: string;
  scope: {
    capabilityIds: string[];
    allowedTables?: string[];
    allowedDomains?: string[];
    allowedPaths?: string[];
    maxRows?: number;
    maxAmount?: number;
    currency?: string;
    objectIds?: string[];
    resourceTypes?: string[];
  };
  nonce: string;
  expiresAt: number;
};

// Simulated GCP KMS Asymmetric Keys (in-memory for development)
// In production, these would be managed securely by a cloud key management service
let _privateKey: string;
let _publicKey: string;

function getKeys() {
  if (!_privateKey || !_publicKey) {
    if (process.env.GOVERNOR_PRIVATE_KEY && process.env.GOVERNOR_PUBLIC_KEY) {
      // In production, these would be managed securely by a cloud key management service (e.g. GCP KMS)
      // Here we load from environment variables securely, fixing ephemeral key regeneration across reboots.
      _privateKey = process.env.GOVERNOR_PRIVATE_KEY.replace(/\\n/g, '\n');
      _publicKey = process.env.GOVERNOR_PUBLIC_KEY.replace(/\\n/g, '\n');
    } else {
      if (process.env.NODE_ENV === 'production') {
          throw new Error("CRITICAL: GOVERNOR_PRIVATE_KEY and GOVERNOR_PUBLIC_KEY environment variables are required in production.");
      }
      
      logger.warn("⚠️ [SECURITY WARNING] Generating ephemeral KMS keys for development. Tokens will invalidate on restart.");
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'secp256k1',
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      _publicKey = publicKey;
      _privateKey = privateKey;
    }
  }
  return { publicKey: _publicKey, privateKey: _privateKey };
}

/**
 * Deterministically sorts an object to ensure consistent stringification for hashing.
 */
function canonicalizeJSON(obj: any): string {
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
        return `[${obj.map(canonicalizeJSON).join(',')}]`;
    }
    const keys = Object.keys(obj).sort();
    const props = keys.map(k => `${JSON.stringify(k)}:${canonicalizeJSON(obj[k])}`);
    return `{${props.join(',')}}`;
}


export class KMSService {
  
  /**
   * Generates a strict, canonical payload hash binding context logic as per v1.2 spec.
   */
  static generatePayloadHash(
      tenantId: string, 
      taskId: string, 
      proposalId: string, 
      decisionId: string, 
      payload: any, 
      nonce: string
  ): string {
    const canonicalPayload = canonicalizeJSON(payload);
    const rawString = `${tenantId}|${taskId}|${proposalId}|${decisionId}|${canonicalPayload}|${nonce}`;
    return crypto.createHash('sha256').update(rawString).digest('hex');
  }

  /**
   * Signs the Token Payload using the simulated KMS Private Key.
   */
  static signToken(tokenPayload: ApprovalTokenPayload): string {
    const { privateKey } = getKeys();
    const sign = crypto.createSign('SHA256');
    sign.update(canonicalizeJSON(tokenPayload));
    sign.end();
    return sign.sign(privateKey, 'base64');
  }

  /**
   * Verifies the Token Payload + Signature using the Public Key.
   */
  static verifyTokenSignature(tokenPayload: ApprovalTokenPayload, signature: string): boolean {
    const { publicKey } = getKeys();
    const verify = crypto.createVerify('SHA256');
    verify.update(canonicalizeJSON(tokenPayload));
    verify.end();
    return verify.verify(publicKey, signature, 'base64');
  }
  
  /**
   * Atomically consumes a token from the DB. Implements Single-Use enforcement.
   * Returns true if successfully consumed, false if already used or expired.
   */
  static async consumeToken(nonce: string): Promise<boolean> {
     const result = await prisma.approvalToken.updateMany({
        where: {
            nonce,
            used: false,
            expiresAt: { gte: new Date() }
        },
        data: {
            used: true,
            usedAt: new Date()
        }
     });
     return result.count > 0;
  }
}
