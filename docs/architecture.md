# Covernor Platform Architecture (v3.0)

## Purpose
Provide a high-assurance, cryptographically enforced governance framework for AI agents where planning, safety testing, policy enforcement, and execution are strictly separated.

## System Roles

1. **Intake (Webhook & REST API)**
   Ingests objectives via Meta Webhooks or REST endpoints, managing deduplication (`x-idempotency-key`) and payload caching.
   
2. **Advisor (The Planner)**
   Unstructured LLM logic. Generates `ProposalJSON` strategies with fallback options based on the `Objective`. Has no direct means of execution.

3. **Critic (The Internal Auditor)**
   A secondary evaluator that checks the Advisor's proposal against a strict Zod `SchemaLock` to detect injection attacks or structural deviations before passing it to the Covernor.

4. **Covernor (The Firewall)**
   A deterministic, code-only policy engine that evaluates proposals against `policies.json`.
   Decisions:
   - `APPROVE`: Generates a single-use ECDSA-signed KMS capability token.
   - `APPROVE_WITH_CONSTRAINTS`: Injects hard bounds into the execution context.
   - `REJECT_AND_REPLAN`: Demands a retry from the Advisor.
   - `BLOCK_AND_ESCALATE`: Routes to a human queue for `K-of-N` Dual Approval.

5. **Operator (The Hands)**
   A sandboxed execution environment. Bound by strict `OperatorContracts` (e.g. `maxRowsAffected`, `requiresIdempotency`). Validates the KMS token signature and TTL before executing against real-world APIs or Databases.

## Workflow (BullMQ Asynchronous Orchestration)

```text
User Task (REST or Webhook) -> BullMQ `workflow-orchestrator`
↓
Advisor generates proposal
↓
Critic evaluates payload schema
↓
Covernor validates constraints & capabilities
↓
Covernor outputs a Decision (e.g., APPROVE_WITH_CONSTRAINTS)
↓
Operator consumes Decision and KMS signature, executes plan
↓
Execution Record committed to Database
↓
Advisor may replan if required or Workflow completes
```

## Core Subsystems

**Capability Registry**
Separates LLM-proposed `actionTypes` from physical capabilities. A proposed action must map to an explicitly allowed capability to proceed.

**Cryptographic Audit & KMS**
Every execution requires a one-time ECDSA token signed by the Covernor. Actions are chained together in an tamper-evident `AuditLog` hash chain.

**Financial Dual Approval & Replay Protection**
High-risk tasks require asynchronous `K-of-N` approvals in the `approval-console` UI. Operator parameters contain deterministic idempotency keys.

**Background Workers**
1. `ExecutionReconciliationWorker`: Sweeps for dropped TCP connections on `EXECUTING` tasks.
2. `HumanEscalationWorker`: Auto-expires untouched `AWAITING_HUMAN` decisions.
3. `AuditSnapshotWorker`: Continuously backs up hash chains into immutable `.jsonl` files.
