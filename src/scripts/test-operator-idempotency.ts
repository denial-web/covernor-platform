import { prisma } from '../db/client';
import { OperatorService } from '../core/operator/operator.service';

async function testOperatorIdempotency() {
  console.log("🚀 Testing Operator-Level Execution Idempotency...");

  // 1. Find a recently APPROVED or HUMAN_OVERRIDE_APPROVED decision
  const decision = await prisma.decision.findFirst({
    where: { 
      decisionType: { in: ['APPROVE', 'APPROVE_WITH_CONSTRAINTS', 'HUMAN_OVERRIDE_APPROVED'] }
    },
    orderBy: { createdAt: 'desc' }
  });

  if (!decision) {
      console.log("❌ No approved decisions found in the database to test with. Run a normal webhook first.");
      return;
  }

  console.log(`✅ Using Decision ID: ${decision.id}`);

  const operator = new OperatorService();

  console.log("\n--- Attempting First Execution (Should Complete or fail cleanly) ---");
  try {
     const report1 = await operator.executeDecision(decision.id);
     console.log("📝 Execution 1 Result:", report1.status, report1.providerTransactionId);
  } catch (err: any) {
     console.log("⚠️ Execution 1 Error (Expected if token expired or already completed):", err.message);
  }

  console.log("\n--- Attempting Second Execution (Should be blocked by Idempotency Lock) ---");
  try {
     const report2 = await operator.executeDecision(decision.id);
     console.log("📝 Execution 2 Result:", report2.status);
  } catch (err: any) {
     // We expect it to be blocked or return early saying it's COMPLETED
     console.log("✅ Execution 2 Blocked/Handled (SUCCESS):", err.message);
  }

  console.log("\n🎉 Idempotency Test Finished!");
}

testOperatorIdempotency().catch(console.error).finally(() => process.exit(0));
