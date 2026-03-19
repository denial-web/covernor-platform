import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import Redis from 'ioredis';
import routes from './api/routes';
import { ExecutionReconciliationWorker } from './workers/execution-reconciliation.worker';
import { HumanEscalationWorker } from './workers/human-escalation.worker';
import { AuditSnapshotWorker } from './workers/audit-snapshot.worker';
import { rateLimiter } from './api/rate-limiter.middleware';
import { logger } from './utils/logger';
import { prisma } from './db/client';

async function checkRedis(): Promise<void> {
  const host = process.env.REDIS_HOST || 'localhost';
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  const client = new Redis(port, host, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    lazyConnect: true,
  });
  try {
    await client.connect();
    await client.ping();
    await client.quit();
  } catch {
    logger.error(
      `Cannot connect to Redis at ${host}:${port}. ` +
      `BullMQ requires Redis. Start it with:\n` +
      `  brew services start redis          # macOS (Homebrew)\n` +
      `  sudo systemctl start redis         # Linux\n` +
      `  docker run -d -p 6379:6379 redis   # Docker`
    );
    process.exit(1);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'x-user-id', 'x-api-key', 'x-idempotency-key'],
  maxAge: 86400,
}));

app.use(express.json({ 
  limit: '100kb',
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));

app.use('/api', rateLimiter({ windowSeconds: 60, maxRequests: 100 }));
app.use('/api', routes);

app.get('/health', async (req, res) => {
  const checks: Record<string, string> = { server: 'ok' };
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }
  try {
    const client = new Redis(
      parseInt(process.env.REDIS_PORT || '6379', 10),
      process.env.REDIS_HOST || 'localhost',
      { maxRetriesPerRequest: 1, connectTimeout: 2000, lazyConnect: true }
    );
    await client.connect();
    await client.ping();
    await client.quit();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
  }
  const healthy = Object.values(checks).every(v => v === 'ok');
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'healthy' : 'degraded', checks });
});

if (require.main === module) {
  checkRedis().then(() => {
    let reconciliationWorker: ExecutionReconciliationWorker;
    let escalationWorker: HumanEscalationWorker;
    let auditSnapshotWorker: AuditSnapshotWorker;

    const server = app.listen(PORT, () => {
      logger.info(`Covernor Platform running on http://localhost:${PORT}`);

      reconciliationWorker = new ExecutionReconciliationWorker();
      reconciliationWorker.start();

      escalationWorker = new HumanEscalationWorker();
      escalationWorker.start();

      auditSnapshotWorker = new AuditSnapshotWorker();
      auditSnapshotWorker.start();
    });

    const gracefulShutdown = async () => {
      logger.info('Shutdown signal received: draining workers and closing HTTP server...');

      reconciliationWorker?.stop();
      escalationWorker?.stop();
      auditSnapshotWorker?.stop();

      try {
        const { WorkflowCoordinator, workflowQueue } = await import('./core/workflow/coordinator.service');
        const { GovernorService } = await import('./core/governor/governor.service');

        await WorkflowCoordinator.getInstance().shutdown();
        await workflowQueue.close();
        await GovernorService.shutdown();
        logger.info('Background orchestrators disabled safely.');
      } catch (e: any) {
        logger.error('Failed to shutdown orchestrators:', { error: e.message });
      }

      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
    };

    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
  });
}

export default app;
