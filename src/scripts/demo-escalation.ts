import 'dotenv/config';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const API_KEY = process.env.ADMIN_API_KEY || 'development_admin_key';
const TENANT_ID = 'default_tenant';

async function runEscalationDemo() {
  console.log('--- STARTING ESCALATION DEMO (via HTTP API) ---\n');

  // 1. Inject a high-risk Transfer Funds task through the API
  console.log('[Step 1] Creating a high-risk TRANSFER_FUNDS task...');
  const createRes = await fetch(`${API_URL}/api/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': TENANT_ID,
      'x-user-id': 'demo_admin',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify({
      objective: 'Issue a $1,000 refund to user account 4492 due to product failure.',
      context: {
        source: 'DEMO_ESCALATE',
        provenance: { recipient: 'SYSTEM_VERIFIED' },
      },
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json();
    console.error('Failed to create task:', err);
    process.exit(1);
  }

  const { task } = await createRes.json();
  console.log(`[Task Created] ID: ${task.id}`);
  console.log(`[Task Created] Objective: ${task.objective}\n`);

  // 2. Poll for the Governor to process and escalate
  console.log('[Step 2] Waiting for Governor to evaluate and escalate...');
  const maxWait = 30000;
  const start = Date.now();
  let finalStatus = task.status;

  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 1500));
    process.stdout.write('.');

    const decisionsRes = await fetch(`${API_URL}/api/decisions`, {
      headers: { 'x-tenant-id': TENANT_ID, 'x-user-id': 'demo_admin', 'x-api-key': API_KEY },
    });

    if (decisionsRes.ok) {
      const decisions = await decisionsRes.json();
      const match = decisions.find((d: any) => d.proposal?.task?.id === task.id);
      if (match) {
        finalStatus = 'AWAITING_HUMAN';
        console.log('\n');
        console.log(`[Governor Decision] Type: ${match.decisionType}`);
        console.log(`[Governor Decision] Risk: ${match.riskLevel}`);
        console.log(`[Governor Decision] ID: ${match.id}`);

        const policyResults = match.policyResults || {};
        for (const [key, pol] of Object.entries(policyResults) as any) {
          console.log(`  -> Policy "${pol.policyId}": ${pol.reason}`);
        }
        console.log('');
        break;
      }
    }
  }

  if (finalStatus === 'AWAITING_HUMAN') {
    console.log('=== SUCCESS ===');
    console.log('The Governor caught the $1,000 transfer and escalated it for human review.');
    console.log('');
    console.log('Open http://localhost:5173 in your browser to see it in the Approval Console.');
    console.log('Click the task, review the policy rejection, and press "Approve Override".');
  } else {
    console.log(`\nUnexpected final status: ${finalStatus}`);
    console.log('The task may still be processing. Check the server logs.');
  }
}

runEscalationDemo().catch(err => {
  console.error('Demo script failed:', err.message);
  process.exit(1);
});
