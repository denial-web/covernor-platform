import { Request, Response } from 'express';
import crypto from 'crypto';
import { WorkflowCoordinator } from '../../core/workflow/coordinator.service';
import { prisma } from '../../db/client';
import { mapMetaEventToObjective } from './meta.parser';

import { logger } from '../../utils/logger';

// In production, this must match the "Verify Token" you set in your Meta App Dashboard
const getMetaVerifyToken = () => {
    const token = process.env.META_VERIFY_TOKEN;
    if (!token) throw new Error("CRITICAL STARTUP ERROR: META_VERIFY_TOKEN is not set.");
    return token;
};

/**
 * Handles Facebook Graph API webhook verification requests.
 * Facebook sends a GET request with `hub.mode`, `hub.verify_token`, and `hub.challenge`.
 * We must echo back the `hub.challenge` if the token matches.
 */
export const verifyMetaWebhook = (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === getMetaVerifyToken()) {
      logger.info('✅ WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
};

/**
 * Validates the HMAC SHA-256 signature sent by Facebook to prove the payload is authentic.
 */
function verifySignature(req: any): boolean {
  const signatureHeader = req.headers['x-hub-signature-256'] as string;
  if (!signatureHeader) return false;

  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
      logger.error('❌ Missing META_APP_SECRET environment variable.');
      return false;
  }
  
  // Use captured raw TCP buffer to prevent character encoding hash mismatch
  const payload = req.rawBody ? req.rawBody : Buffer.from(JSON.stringify(req.body));
  
  try {
    const hmac = crypto.createHmac('sha256', appSecret);
    const digest = `sha256=${hmac.update(payload).digest('hex')}`;
    
    const sigBuffer = Buffer.from(signatureHeader);
    const digestBuffer = Buffer.from(digest);
    
    if (sigBuffer.byteLength !== digestBuffer.byteLength) {
        return false;
    }
    
    return crypto.timingSafeEqual(sigBuffer, digestBuffer);
  } catch(e) {
    return false;
  }
}

/**
 * Receives POST events directly from the Meta Graph API.
 */
export const receiveMetaWebhook = async (req: Request, res: Response) => {
  const body = req.body;

  // 1. Verify Request Authenticity 
  // Enforced in production to prevent malicious payloads
  if (!verifySignature(req)) {
     logger.error('❌ Failed Meta Webhook Signature Verification');
     return res.sendStatus(403);
  }

  // 2. Ensure payload is a valid Pages event
  if (body.object === 'page') {
    // Return a '200 OK' response to all requests successfully received
    res.status(200).send('EVENT_RECEIVED');

    // Iterate over each entry - there may be multiple if batched
    for (const entry of body.entry) {
      // --- Phase 9: Freshness Strategy ---
      // Webhooks delayed by queues could result in stale actions.
      // E.g., handling a 2-hour old refund request might be dangerous.
      if (entry.time) {
        const eventAgeMs = Date.now() - entry.time;
        // 5 Minutes (300,000 ms) strict TTL
        if (eventAgeMs > 300000) {
           logger.warn(`⏳ [Freshness Violation] Discarding stale Meta event (${Math.floor(eventAgeMs/1000)}s old). TTL is 300s.`);
           continue; // Skip this entry
        }
      }

      // Get the webhook event. entry.messaging is an array, but 
      // will only ever contain one event, so we get index 0
      const webhookEvents = entry.changes || entry.messaging;
      
      logger.info('✅ Received Meta Webhook Event:', { event: JSON.stringify(webhookEvents, null, 2) });

      for (const event of webhookEvents) {
        const objective = mapMetaEventToObjective(event);
        
        if (objective) {
          try {
            // --- Phase 9: Idempotency Strategy ---
            // Construct a deterministic hash from the parent entry timestamp and the child event ID
            // If Facebook replays this exact webhook, the hash remains identical.
            const uniqueEventId = event.value?.post_id || event.value?.comment_id || event.message?.mid || entry.id;
            const seed = `${entry.time}_${uniqueEventId}`;
            const idempotencyKey = crypto.createHash('sha256').update(seed).digest('hex');

            const task = await prisma.task.create({
              data: {
                tenantId: 'default_tenant', // In production, map this from the Page ID
                idempotencyKey,
                objective,
                status: 'PENDING'
              }
            });
            // Automatically push to orchestrator with contextual provenance
            const c = WorkflowCoordinator.getInstance();
            
            await c.processTask(task.id, task.objective, {
                 source: 'META_WEBHOOK',
                 provenance: {
                    // Any parameter derived explicitly from this source gets UNTRUSTED_PROVENANCE since it's raw user input
                    amount: 'UNTRUSTED_USER_INPUT',
                    recipient: 'UNTRUSTED_USER_INPUT',
                    message: 'UNTRUSTED_USER_INPUT'
                 }
            });
            logger.info(`📝 [Task Queued] Successfully ingested Meta event -> Task ${task.id}`);
          } catch (error: any) {
            // Prisma Code P2002: "Unique constraint failed"
            if (error.code === 'P2002') {
               logger.warn(`[Idempotency Guard] Ignoring duplicate Webhook Event ${entry.id}. Already processed.`);
               // Do not enqueue again, but DO NOT return 4xx or 5xx, or Facebook will keep retrying
            } else {
               logger.error('❌ Failed to create Task from Meta Webhook Event', { error });
            }
          }
        } else {
          logger.warn('⚠️ Meta event discarded: Did not match supported schemas.');
        }
      }
    }
  } else {
    // Return a '404 Not Found' if event is not from a page subscription
    res.sendStatus(404);
  }
};
