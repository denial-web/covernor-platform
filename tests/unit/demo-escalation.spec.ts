import { PolicyEngine } from '../../src/core/governor/policies/engine';
import { GovernorService } from '../../src/core/governor/governor.service';
import { GovernorEscalationError } from '../../src/core/errors/pipeline.errors';
import { MinisterService } from '../../src/core/minister/minister.service';
import { CapabilityService } from '../../src/core/policy/capability.registry';
import { OperatorService } from '../../src/core/operator/operator.service';
import { prismaMock } from '../setup/prisma-mock';

jest.mock('../../src/core/minister/llm.provider', () => ({
  LLMProvider: jest.fn().mockImplementation(() => ({
    generateStrategy: jest.fn().mockRejectedValue(new Error('mock llm offline')),
  })),
}));

jest.mock('../../src/db/audit.logger', () => ({
  AuditLogger: {
    logAction: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('Demo escalation flow (offline)', () => {
  const demoContext = {
    source: 'DEMO_ESCALATE',
    provenance: { recipient: 'SYSTEM_VERIFIED' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.governorPolicy.findFirst.mockResolvedValue(null);
    prismaMock.governorPolicy.count.mockResolvedValue(0);
    prismaMock.governorPolicy.create.mockResolvedValue({} as never);
  });

  it('PolicyEngine escalates $1,000 TRANSFER_FUNDS like demo-escalation.ts', async () => {
    const engine = new PolicyEngine();
    const { results } = await engine.evaluateOptions(
      'default_tenant',
      'TRANSFER_FUNDS',
      { amount: 1000, recipient: 'user_4492' },
      demoContext,
    );

    const escalate = results.find((r) => r.policyId === 'POL_03_REQUIRE_HUMAN_APPROVAL');
    expect(escalate?.action).toBe('ESCALATE');
    expect(results.some((r) => r.action === 'REJECT')).toBe(false);
  });

  it('MinisterService uses DEMO_ESCALATE mock when LLM is unavailable', async () => {
    prismaMock.proposal.create.mockResolvedValue({
      id: 'prop-demo',
      recommendedOption: {
        actionType: 'TRANSFER_FUNDS',
        parameters: { amount: 1000, recipient: 'user_4492' },
      },
    } as never);

    const minister = new MinisterService();
    await minister.generateProposal('task-demo', 'Issue refund', demoContext, 'default_tenant');

    expect(prismaMock.proposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recommendedOption: {
            actionType: 'TRANSFER_FUNDS',
            parameters: { amount: 1000, recipient: 'user_4492' },
            riskEstimate: 'HIGH',
          },
          contextSignals: demoContext,
        }),
      }),
    );
  });

  it('GovernorService escalates demo transfer for human review', async () => {
    prismaMock.proposal.findUnique.mockResolvedValue({
      id: 'prop-demo',
      tenantId: 'default_tenant',
      taskId: 'task-demo',
      contextSignals: demoContext,
      recommendedOption: {
        actionType: 'TRANSFER_FUNDS',
        parameters: { amount: 1000, recipient: 'user_4492' },
      },
      task: { id: 'task-demo', tenantId: 'default_tenant' },
    } as never);
    prismaMock.decision.create.mockResolvedValue({ id: 'dec-demo' } as never);
    prismaMock.proposal.update.mockResolvedValue({} as never);

    const capability = CapabilityService.getCapabilityForTool('TRANSFER_FUNDS');
    const contract = new OperatorService().getToolContract('TRANSFER_FUNDS');
    expect(capability?.id).toBe('financial.transfer');
    expect(contract).toBeDefined();

    const governor = new GovernorService();
    await expect(governor.evaluateProposal('prop-demo')).rejects.toBeInstanceOf(GovernorEscalationError);

    expect(prismaMock.decision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decisionType: 'BLOCK_AND_ESCALATE',
          riskLevel: 'HIGH',
        }),
      }),
    );
  });
});
