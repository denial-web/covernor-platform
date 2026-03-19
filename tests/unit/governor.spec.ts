import { GovernorService } from '../../src/core/governor/governor.service';
import { PolicyEngine } from '../../src/core/governor/policies/engine';
import { CapabilityService } from '../../src/core/policy/capability.registry';
import { OperatorService } from '../../src/core/operator/operator.service';
import { prismaMock } from '../../tests/setup/prisma-mock';

// Mock dependencies
jest.mock('../../src/core/governor/policies/engine');
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => {
    return {
      on: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      quit: jest.fn()
    };
  });
});
jest.mock('../../src/core/policy/capability.registry');
jest.mock('../../src/core/operator/operator.service');
jest.mock('../../src/core/crypto/kms.service');

describe('GovernorService (with PolicyEngine)', () => {
  let governor: GovernorService;

  beforeEach(() => {
    governor = new GovernorService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should REJECT_AND_REPLAN a proposal if PolicyEngine rejects it', async () => {
    prismaMock.proposal.findUnique.mockResolvedValue({
      id: 'prop-1',
      tenantId: 'tenant-1',
      taskId: 'task-1',
      contextSignals: {},
      recommendedOption: { actionType: 'MODIFY_DATABASE', parameters: {} },
      task: { id: 'task-1', tenantId: 'tenant-1' }
    } as any);

    (CapabilityService.getCapabilityForTool as jest.Mock).mockReturnValue({ id: 'MODIFY_DATABASE' });
    (OperatorService.prototype.getToolContract as jest.Mock).mockReturnValue({ allowedParameterSchema: null });
    
    // Mock engine to return a REJECT result
    (PolicyEngine.prototype.evaluateOptions as jest.Mock).mockResolvedValue({
      versionHash: 'mock-hash',
      results: [
        { policyId: 'P1', action: 'REJECT', riskAssigned: 'CRITICAL' }
      ]
    });

    prismaMock.decision.create.mockResolvedValue({ id: 'dec-1' } as any);

    await expect(governor.evaluateProposal('prop-1')).rejects.toThrow();

    expect(prismaMock.decision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decisionType: 'REJECT_AND_REPLAN',
          riskLevel: 'CRITICAL'
        })
      })
    );
  });

  it('should APPROVE_WITH_CONSTRAINTS if PolicyEngine injects constraints', async () => {
    prismaMock.proposal.findUnique.mockResolvedValue({
      id: 'prop-2',
      tenantId: 'tenant-1',
      taskId: 'task-1',
      contextSignals: {},
      recommendedOption: { actionType: 'READ_DATABASE', parameters: {} },
      task: { id: 'task-1', tenantId: 'tenant-1' }
    } as any);

    (CapabilityService.getCapabilityForTool as jest.Mock).mockReturnValue({ id: 'READ_DATABASE' });
    (OperatorService.prototype.getToolContract as jest.Mock).mockReturnValue({ allowedParameterSchema: null });
    
    // Mock engine to inject constraints
    (PolicyEngine.prototype.evaluateOptions as jest.Mock).mockResolvedValue({
      versionHash: 'mock-hash',
      results: [
        { policyId: 'P2', action: 'INJECT_CONSTRAINT', riskAssigned: 'MEDIUM', injectedConstraints: { limit: 5 } }
      ]
    });

    prismaMock.decision.create.mockResolvedValue({ id: 'dec-2' } as any);

    await governor.evaluateProposal('prop-2');

    expect(prismaMock.decision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decisionType: 'APPROVE_WITH_CONSTRAINTS',
          riskLevel: 'MEDIUM',
          constraints: { limit: 5 }
        })
      })
    );
  });
});
