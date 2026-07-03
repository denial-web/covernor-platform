import { issueToken } from '../../src/api/auth.middleware';
import { prismaMock } from '../setup/prisma-mock';

jest.mock('../../src/api/rate-limiter.middleware', () => ({
  rateLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../src/core/workflow/coordinator.service', () => ({
  WorkflowCoordinator: {
    getInstance: jest.fn().mockReturnValue({
      processTask: jest.fn().mockResolvedValue(true),
    }),
  },
  workflowQueue: { close: jest.fn() },
}));

import request from 'supertest';
import app from '../../src/server';

describe('API Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.ADMIN_API_KEY = 'test-key';
    process.env.NODE_ENV = 'test';
  });

  it('POST /api/tasks should create a task and return 201', async () => {
    const adminToken = issueToken('test-user', 'test-tenant', 'admin');
    prismaMock.task.create.mockResolvedValueOnce({
      id: 'task-123',
      status: 'PENDING',
      objective: 'Test integration',
      contextParams: JSON.stringify({}),
      tenantId: 'test-tenant',
      createdAt: new Date(),
    } as never);

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ objective: 'Test integration', context: {} });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('task');
    expect(res.body.task.id).toBe('task-123');
  });

  it('POST /api/tasks rejects unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ objective: 'Test integration' });

    expect(res.status).toBe(400);
  });
});
