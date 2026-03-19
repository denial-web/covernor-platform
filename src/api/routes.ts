import { Router } from 'express';
import { createTask, getProposal, getDecision, getAuditLogs, overrideDecision, getMetrics, getTrainingDataset, rollbackPolicy, getEscalatedDecisions } from './controllers';
import { verifyMetaWebhook, receiveMetaWebhook } from './webhooks/meta.controller';
import { requireAdminAuth } from './auth.middleware';
import { settingsRouter } from './settings.controller';

const router = Router();

// Internal SaaS Management Routes (Protected)
router.use('/tasks', requireAdminAuth);
router.use('/proposals', requireAdminAuth);
router.use('/decisions', requireAdminAuth);
router.use('/audit', requireAdminAuth);
router.use('/metrics', requireAdminAuth);
router.use('/training', requireAdminAuth);
router.use('/policies', requireAdminAuth);
router.use('/settings', settingsRouter);

router.post('/tasks', createTask);
router.get('/proposals/:id', getProposal);
router.get('/decisions', getEscalatedDecisions);
router.get('/decisions/:proposalId', getDecision);
router.post('/decisions/:id/override', overrideDecision);
router.get('/audit/logs', getAuditLogs);
router.get('/metrics', getMetrics);
router.get('/training/dataset', getTrainingDataset);
router.post('/policies/rollback', rollbackPolicy);

// External Webhook Ingestion Routes (Phase 1)
router.get('/webhooks/meta', verifyMetaWebhook);
router.post('/webhooks/meta', receiveMetaWebhook);

export default router;
