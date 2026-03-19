import { Router } from 'express';
import { createTask, getProposal, getDecision, getAuditLogs, overrideDecision, getMetrics, getTrainingDataset, rollbackPolicy, getEscalatedDecisions } from './controllers';
import { verifyMetaWebhook, receiveMetaWebhook } from './webhooks/meta.controller';
import { requireAuth, requireRole, loginHandler } from './auth.middleware';
import { settingsRouter } from './settings.controller';

const router = Router();

router.post('/auth/login', loginHandler);

router.use('/tasks', requireAuth);
router.use('/proposals', requireAuth);
router.use('/decisions', requireAuth);
router.use('/audit', requireAuth);
router.use('/metrics', requireAuth);
router.use('/training', requireAuth);
router.use('/policies', requireAuth);
router.use('/settings', settingsRouter);

router.post('/tasks', requireRole('admin', 'operator'), createTask);
router.get('/proposals/:id', requireRole('admin', 'approver', 'viewer'), getProposal);
router.get('/decisions', requireRole('admin', 'approver', 'viewer'), getEscalatedDecisions);
router.get('/decisions/:proposalId', requireRole('admin', 'approver', 'viewer'), getDecision);
router.post('/decisions/:id/override', requireRole('admin', 'approver'), overrideDecision);
router.get('/audit/logs', requireRole('admin'), getAuditLogs);
router.get('/metrics', requireRole('admin', 'viewer'), getMetrics);
router.get('/training/dataset', requireRole('admin'), getTrainingDataset);
router.post('/policies/rollback', requireRole('admin'), rollbackPolicy);

router.get('/webhooks/meta', verifyMetaWebhook);
router.post('/webhooks/meta', receiveMetaWebhook);

export default router;
