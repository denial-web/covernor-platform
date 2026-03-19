import 'dotenv/config';
import express from 'express';
import Redis from 'ioredis';
import routes from './api/routes';
import { ExecutionReconciliationWorker } from './workers/execution-reconciliation.worker';
import { HumanEscalationWorker } from './workers/human-escalation.worker';
import { AuditSnapshotWorker } from './workers/audit-snapshot.worker';
import { logger } from './utils/logger';

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

app.use(express.json({ 
  limit: '100kb',
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));

app.use('/api', routes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

if (require.main === module) {
  checkRedis().then(() => {
    let reconciliationWorker: ExecutionReconciliationWorker;
    let escalationWorker: HumanEscalationWorker;
    let auditSnapshotWorker: AuditSnapshotWorker;

    const server = app.listen(PORT, () => {
      logger.info(`Minister-Governor Platform running on http://localhost:${PORT}`);

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
