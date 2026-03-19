import { WorkflowCoordinator } from '../../src/core/workflow/coordinator.service';
import { MinisterService } from '../../src/core/minister/minister.service';
import { OperatorService } from '../../src/core/operator/operator.service';
import { GovernorService } from '../../src/core/governor/governor.service';
import { GovernorRejectionError } from '../../src/core/errors/pipeline.errors';
import { prismaMock } from '../../tests/setup/prisma-mock';

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    getActiveCount: jest.fn(),
    getWaitingCount: jest.fn(),
    getFailedCount: jest.fn()
  })),
  Worker: jest.fn()
}));
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    quit: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn()
  }));
});

import { CriticService } from '../../src/core/critic/critic.service';
import { SchemaValidator } from '../../src/core/policy/schema.validator';

describe('Full System Integration: Intake -> Advisor -> Covernor -> Operator', () => {
  let coordinator: WorkflowCoordinator;

  beforeAll(async () => {
    coordinator = WorkflowCoordinator.getInstance();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(CriticService.prototype, 'evaluate').mockResolvedValue({ isValid: true, reasonCode: 'OK', confidence: 0.99 } as any);
    jest.spyOn(SchemaValidator, 'validateCriticPayload').mockReturnValue({ isValid: true, reasonCode: 'OK', confidence: 0.99 } as any);
  });

  afterAll(async () => {
    // cleanup
  });

  it('should process a safe Task end-to-end', async () => {
    // 1. Intake Target ID
    const taskId = 'test-task-1';
    const propId = 'prop-int-1';

    // Mock DB Tasks
    prismaMock.task.create.mockResolvedValueOnce({ id: taskId } as any);
    prismaMock.task.update.mockResolvedValue({ id: taskId } as any);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'log-1' } as any);

    // AI Proposal logic bypass
    jest.spyOn(MinisterService.prototype, 'generateProposal').mockResolvedValue({
      id: propId,
      taskId: taskId,
      recommendedOption: {
        actionType: 'READ_DATABASE',
        parameters: { query: 'SELECT * FROM users' },
        riskEstimate: 'LOW'
      },
      fallbackOptions: JSON.stringify([]),
      contextSignals: JSON.stringify({}),
      status: 'PENDING',
      createdAt: new Date()
    } as any);

    // Mock Proposal creation within Advisor
    prismaMock.proposal.create.mockResolvedValue({
      id: propId,
      taskId: taskId,
      recommendedOption: {
        actionType: 'READ_DATABASE',
        parameters: { query: 'SELECT * FROM users' },
        riskEstimate: 'LOW'
      },
      fallbackOptions: JSON.stringify([]),
      contextSignals: JSON.stringify({}),
      status: 'PENDING',
      createdAt: new Date()
    } as any);

    // DB Proposal retrieval for Covernor
    prismaMock.proposal.findUnique.mockResolvedValue({
       id: propId,
       recommendedOption: {
           actionType: 'READ_DATABASE',
           parameters: { query: 'SELECT * FROM users' },
           riskEstimate: 'LOW'
       }
    } as any);

    // Mock Decision data
    prismaMock.decision.create.mockResolvedValue({ 
        id: 'dec-1',
        decisionType: 'APPROVE_WITH_CONSTRAINTS',
        riskLevel: 'LOW',
        approvedAction: { actionType: 'READ_DATABASE', parameters: { limit: 50 } }
    } as any);
    prismaMock.decision.findUnique.mockResolvedValue({
        id: 'dec-1',
        decisionType: 'APPROVE_WITH_CONSTRAINTS',  // Needed so Workflow internally triggers execution
        approvedAction: { actionType: 'READ_DATABASE', parameters: { query: 'SELECT * FROM users', limit: 50 } },
        proposal: {
            recommendedOption: { actionType: 'READ_DATABASE', parameters: { query: 'SELECT * FROM users', limit: 50 } }
        }
    } as any);
    
    // Bypass Operator execution since this test focuses only on the WorkflowCoordinator loop
    jest.spyOn(OperatorService.prototype, 'executeDecision').mockResolvedValue({ 
        id: 'exec-1', 
        status: 'SUCCESS' 
    } as any);

    prismaMock.executionRecord.create.mockResolvedValue({ id: 'exec-1', status: 'SUCCESS' } as any);

    // Run the loop directly to bypass BullMQ async queueing
    await (coordinator as any)._executeTaskLoop(taskId, 'Do work', {}, 'default_tenant');

    // Verify DB State update traces
    expect(prismaMock.task.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: taskId } })
    );

    // Expect Covernor to log an approval decision
    expect(prismaMock.decision.create).toHaveBeenCalledWith(
         expect.objectContaining({
            data: expect.objectContaining({ decisionType: 'APPROVE_WITH_CONSTRAINTS' })
         })
    );
  });

  it('should hit the replay circuit breaker on CRITICAL tasks', async () => {
    const taskId = 'test-task-bad';
    const propId = 'prop-int-bad';

    prismaMock.task.create.mockResolvedValueOnce({ id: taskId } as any);
    prismaMock.auditLog.create.mockResolvedValue({ id: 'log-1' } as any);

    // Mock Covernor to forcefully reject and trigger replans
    jest.spyOn(GovernorService.prototype, 'evaluateProposal').mockRejectedValue(new GovernorRejectionError('Mock rejection', 'Suggestion'));

    // The Advisor keeps stubbornly suggesting a bad command
    jest.spyOn(MinisterService.prototype, 'generateProposal').mockResolvedValue({
      id: propId,
      taskId: taskId,
      recommendedOption: {
        actionType: 'TRANSFER_FUNDS', // Triggers POL_04_PROVENANCE_REQUIRED (Since there's no provenance object passed)
        parameters: { amount: 10000, recipient: 'hacker_wallet' },
        riskEstimate: 'CRITICAL'
      },
      fallbackOptions: JSON.stringify([]),
      contextSignals: JSON.stringify({}),
      status: 'PENDING',
      createdAt: new Date()
    } as any);

    prismaMock.proposal.create.mockResolvedValue({
      id: propId,
      taskId: taskId,
      recommendedOption: {
        actionType: 'TRANSFER_FUNDS',
        parameters: { amount: 10000, recipient: 'hacker_wallet' },
        riskEstimate: 'CRITICAL'
      },
      fallbackOptions: JSON.stringify([]),
      contextSignals: JSON.stringify({}),
      status: 'PENDING',
      createdAt: new Date()
    } as any);

    prismaMock.proposal.findUnique.mockResolvedValue({
       id: propId,
       recommendedOption: {
         actionType: 'TRANSFER_FUNDS', 
         parameters: { amount: 10000, recipient: 'hacker_wallet' },
         riskEstimate: 'CRITICAL'
       }
    } as any);

    prismaMock.decision.create.mockResolvedValue({ 
        id: 'dec-2',
        decisionType: 'REJECT_AND_REPLAN',
        riskLevel: 'CRITICAL'
    } as any);

    // Run the loop directly!
    await (coordinator as any)._executeTaskLoop(taskId, 'Delete DB', {}, 'default_tenant');

    // Mocks should show 3 replan generations based on the spy created on line 124
    expect(MinisterService.prototype.generateProposal).toHaveBeenCalledTimes(3);
  });
});


