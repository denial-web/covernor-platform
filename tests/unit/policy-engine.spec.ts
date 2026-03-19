import { PolicyEngine } from '../../src/core/governor/policies/engine';
import fs from 'fs';
import { prismaMock } from '../../tests/setup/prisma-mock';

jest.mock('fs');

describe('PolicyEngine', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    // Mock the policies.json read
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({
      policies: [
        {
          id: 'TEST_DENY',
          targetActionTypes: ['DELETE_DB'],
          ruleType: 'DENY',
          riskLevel: 'CRITICAL',
          description: 'No dropping tables'
        },
        {
          id: 'TEST_CONSTRAINT',
          targetActionTypes: ['READ_RECORDS'],
          ruleType: 'CONSTRAINT',
          constraintInjection: { limit: 10 },
          riskLevel: 'MEDIUM'
        },
        {
          id: 'TEST_ESCALATE',
          targetActionTypes: ['SPEND_MONEY'],
          ruleType: 'ESCALATE',
          conditions: { parameter: 'amount', operator: 'GREATER_THAN', value: 100 },
          riskLevel: 'HIGH'
        }
      ]
    }));

    engine = new PolicyEngine();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should DENY destructive actions', async () => {
    const { results } = await engine.evaluateOptions('DELETE_DB');
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe('REJECT');
    expect(results[0].riskAssigned).toBe('CRITICAL');
  });

  it('should INJECT_CONSTRAINT for read operations', async () => {
    const { results } = await engine.evaluateOptions('READ_RECORDS');
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe('INJECT_CONSTRAINT');
    expect(results[0].injectedConstraints).toEqual({ limit: 10 });
  });

  it('should ESCALATE conditional operations when threshold crossed', async () => {
    const { results } = await engine.evaluateOptions('SPEND_MONEY', { amount: 500 });
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe('ESCALATE');
    expect(results[0].riskAssigned).toBe('HIGH');
  });

  it('should ALLOW conditional operations when threshold is not crossed', async () => {
    const { results } = await engine.evaluateOptions('SPEND_MONEY', { amount: 50 });
    // Since condition was not met, and no other rules block it, it defaults back to pass. No hard Deny hit.
    expect(results).toHaveLength(0);
  });

  it('should DEFAULT ALLOW unknown safe operations', async () => {
    const { results } = await engine.evaluateOptions('HARMLESS_ACTION');
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe('OK');
    expect(results[0].policyId).toBe('DEFAULT_ALLOW');
  });
});
