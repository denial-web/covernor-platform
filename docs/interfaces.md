# The 7 Stable Interfaces of the Minister-Governor System

Most AI agent systems collapse because they lack rigid boundaries. A stable Minister-Governor architecture enforces these boundaries through strict, strongly-typed objects. If these schemas are validated at runtime, the system cannot drift into unsafe autonomous execution.

## 1. The Intake Interface (User -> Minister)
Purpose: Defines exactly what the Minister is allowed to know about the objective. Prevention of reading unrelated system state.
```json
{
  "taskId": "uuid",
  "objective": "Process user refund for order 123",
  "contextSignals": {
    "trustedSource": true,
    "timeframe": "last_7_days"
  }
}
```

## 2. The Proposal Interface (Minister -> Critic -> Governor)
Purpose: The Minister's output. Must never contain executable code. Contains described intentions separated into primary and fallback options.
```json
{
  "proposalId": "uuid",
  "taskId": "uuid",
  "recommendedOption": {
    "actionType": "HTTP_REQUEST",
    "parameters": {"url": "https://api.stripe.com/refund", "method": "POST"},
    "riskEstimate": "HIGH"
  },
  "fallbackOptions": [
    {
       "actionType": "SLACK_MESSAGE",
       "parameters": {"message": "Need help with refund."},
       "riskEstimate": "LOW"
    }
  ]
}
```

## 3. The Decision Interface (Governor -> Operator)
Purpose: Absolute authority record. Dictates exactly what Operator is allowed to do.
```json
{
  "decisionId": "uuid",
  "proposalId": "uuid",
  "decisionType": "APPROVE" | "APPROVE_WITH_CONSTRAINTS" | "REJECT_AND_REPLAN" | "BLOCK_AND_ESCALATE" | "HUMAN_OVERRIDE_APPROVED" | "PENDING_SECOND_APPROVAL",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "policyResults": { "pol_01": { "passed": true } },
  "approvedPayloadHash": "sha256_hash",
  "requiredApprovers": 1,
  "approvalsCount": 0
}
```

## 4. The Approval Token Interface (System Cryptography)
Purpose: Cryptographically guarantees an Operator only executes Governor-approved tasks without replay.
```json
{
  "nonce": "uuid",
  "decisionId": "uuid",
  "taskId": "uuid",
  "proposalId": "uuid",
  "payloadHash": "sha256_hash",
  "signature": "hmac_sha256_signature",
  "expiresAt": "ISO8601",
  "used": false
}
```

## 5. The Execution Record Interface (Operator -> Database)
Purpose: Centralizes external operator state (stalled, failed, unknown) bounded by idempotency keys and retry limits.
```json
{
  "decisionId": "uuid",
  "idempotencyKey": "hash",
  "providerTransactionId": "ext_123",
  "status": "PENDING" | "EXECUTING" | "COMPLETED" | "FAILED" | "UNKNOWN" | "RECONCILIATION_REQUIRED",
  "errorClassification": "FATAL" | "RETRYABLE" | "UNKNOWN",
  "attemptCount": 0,
  "rollbackData": { "previousState": "..." }
}
```

## 6. The Execution Interface (Operator -> External System)
Purpose: Translates parameters to actual REST/SQL driver calls via Capability mapping. Needs the capability string and arguments.
```json
{
  "actionType": "POSTGRESQL_QUERY",
  "parameters": {"query": "SELECT * FROM users"},
  "constraints": {"maxRecords": 50}
}
```

## 7. The Audit Log (Tamper-Evident Ledger)
Purpose: Closes the loop. Provides explicit V2 financial tracking, immutable hashes linking previous states.
```json
{
  "actionDetails": { "event": "EXECUTION_COMPLETE" },
  "amount": 100.50,
  "currency": "USD",
  "recipientAccount": "acct_123",
  "providerTransactionId": "txn_890",
  "previousHash": "abcd123",
  "currentHash": "efgh456"
}
```
