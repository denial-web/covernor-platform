import fs from 'fs';
import path from 'path';
import { Proposal } from '@prisma/client';
import { CriticService } from '../../src/core/critic/critic.service';

interface DoctrineFixtureCase {
  id: string;
  coverageTier: 'required' | 'holdout';
  expected: {
    isValid: boolean;
    reasonCode: string;
  };
  objective: string;
  proposal: {
    actionType: string;
    parameters: Record<string, unknown>;
  };
}

interface DoctrineFixtureBundle {
  version: number;
  stats: { total: number; required: number; holdout: number };
  cases: DoctrineFixtureCase[];
}

const FIXTURE_PATH = path.join(__dirname, '../fixtures/doctrine-critic-cases.json');

function loadBundle(): DoctrineFixtureBundle {
  const raw = fs.readFileSync(FIXTURE_PATH, 'utf8');
  return JSON.parse(raw) as DoctrineFixtureBundle;
}

function toProposal(caseRow: DoctrineFixtureCase): Proposal {
  return {
    id: `doctrine-${caseRow.id}`,
    taskId: 'task-doctrine',
    tenantId: 'tenant-doctrine',
    parentProposalId: null,
    recommendedOption: caseRow.proposal,
    fallbackOptions: [],
    contextSignals: { source: 'doctrine-lab', fixtureId: caseRow.id },
    status: 'PENDING',
    createdAt: new Date(),
  } as unknown as Proposal;
}

describe('CriticService doctrine fixtures', () => {
  const critic = new CriticService();
  const bundle = loadBundle();

  describe('required tier (CI gate)', () => {
    const required = bundle.cases.filter((row) => row.coverageTier === 'required');

    it.each(required.map((row) => [row.id, row] as const))(
      'rejects doctrine attack %s',
      async (_id, caseRow) => {
        const result = await critic.evaluate(toProposal(caseRow), caseRow.objective);
        expect(result.isValid).toBe(caseRow.expected.isValid);
        expect(result.reasonCode).toBe(caseRow.expected.reasonCode);
      },
    );
  });

  describe('holdout tier (recall tracking)', () => {
    it('reports doctrine holdout recall without failing CI', async () => {
      const holdout = bundle.cases.filter((row) => row.coverageTier === 'holdout');
      let caught = 0;
      const gaps: string[] = [];

      for (const caseRow of holdout) {
        const result = await critic.evaluate(toProposal(caseRow), caseRow.objective);
        if (!result.isValid && result.reasonCode === 'VIOLATES_SYSTEM_INSTRUCTIONS') {
          caught += 1;
        } else {
          gaps.push(caseRow.id);
        }
      }

      const recall = holdout.length ? caught / holdout.length : 1;
      // Informational — drives pattern expansion; does not fail the suite.
      // eslint-disable-next-line no-console
      console.log(
        `[doctrine-critic] holdout recall ${caught}/${holdout.length} (${(recall * 100).toFixed(1)}%)`,
      );
      if (gaps.length) {
        // eslint-disable-next-line no-console
        console.log(`[doctrine-critic] gaps: ${gaps.join(', ')}`);
      }
      expect(recall).toBeGreaterThanOrEqual(0);
    });
  });
});
