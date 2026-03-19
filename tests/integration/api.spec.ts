import request from 'supertest';
import app from '../../src/server';
import { prismaMock } from '../../tests/setup/prisma-mock';

jest.mock('../../src/core/workflow/coordinator.service', () => {
  return {
    WorkflowCoordinator: {
      getInstance: jest.fn().mockReturnValue({
        processTask: jest.fn().mockResolvedValue(true)
      })
    }
  };
});

describe('API Endpoints', () => {
  it('POST /api/tasks should create a task and return 201', async () => {
    process.env.ADMIN_API_KEY = 'test-key';
    prismaMock.task.create.mockResolvedValueOnce({ id: 'task-123', status: 'PENDING', objective: 'Test integration', contextParams: JSON.stringify({}), createdAt: new Date() } as any);

    const res = await request(app)
      .post('/api/tasks')
      .set('x-api-key', 'test-key')
      .set('x-tenant-id', 'test-tenant')
      .set('x-user-id', 'test-user')
      .send({ objective: 'Test integration', context: {} });
    
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('task');
    expect(res.body.task.id).toBe('task-123');
  });
});
