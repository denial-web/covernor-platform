# 🛡️ Minister-Governor Platform: Enterprise Hardening Roadmap

*Synthesized from internal architectural design and external LLM architectural reviews (Claude & ChatGPT).*

## Architecture Verdict
* **System architecture:** 8.8/10
* **Security design:** 8.5/10
* **Enterprise potential after hardening:** 9.0/10

**Summary:** The foundational Bicameral design (Separating Minister intelligence from Governor deterministic authority) is structurally correct and vastly superior to standard single-loop agent frameworks. The next phase of development shifts focus from building capabilities to enforcing strict boundaries.

---

## 🚀 Priority 1: Hard Trust Boundary Fixes
*The most critical security and data-integrity requirements.*

- [ ] **Strict JSON Schema Validation**: Insert a non-LLM structural validator (e.g., Zod, JSON Schema) between the Minister and Critic. Malformed payloads must be rejected deterministically before any semantic review.
- [ ] **Operator Parameter Allowlists**: The Governor must enforce exact parameter classes, domain allowlists, path regexes, and SQL operation classes for every Operator.
- [ ] **Signed Action Artifacts**: Add cryptographic payload hashes to approved actions. Operators must reject unsigned or mismatched payloads.
- [ ] **Structured Replan Feedback**: Sanitize Governor rejection feedback into templated, machine-safe codes rather than raw strings to prevent second-order prompt injection.
- [ ] **Untrusted Data Isolation**: Treat all external webhook text and Operator outputs as untrusted data. Clearly delimit it in prompts and prohibit instruction-following from embedded payload content.

## 🏗️ Priority 2: Workflow Integrity
*Crucial for long-running, asynchronous SaaS stability.*

- [ ] **Webhook Idempotency**: Add deduplication keys, per-source rate limiting, and replay protection windows to the Meta webhook ingestion pipeline.
- [ ] **Escalation Lifecycles**: Add `escalatedAt`, `expiresAt`, and a reminder/timeout worker for tasks waiting in the `AWAITING_HUMAN` state.
- [ ] **Append-Only Override Decisions**: Human overrides must create new decision records rather than mutating existing ones. History must be immutable.
- [ ] **State Machine Guards**: Implement optimistic locking and race-condition guards for simultaneous approvals, auto-expiries, and retry loops.
- [ ] **Attempt Tracking & Lineage**: Add `parentProposalId` to track the full lineage of retries and replans for a single objective.
- [ ] **Tenant Isolation**: Add strict `tenantId` scoping to Tasks, Proposals, Decisions, Reports, and Logs for multi-tenant SaaS.

## 🔒 Priority 3: Security Hardening
*Advanced infrastructural resilience.*

- [ ] **Queue-Based Orchestration**: Migrate the synchronous WorkflowCoordinator loop to a durable queue (e.g., BullMQ) with dead-letter handling to survive bursty traffic and timeout failures.
- [ ] **Audit Hash-Chaining**: Implement tamper-evident logging where each Audit Log entry hashes the previous entry to guarantee chain integrity.
- [ ] **Approval Token Anti-Replay**: Ensure Human Override API tokens are strictly single-use and time-bound.
- [ ] **Cumulative Governor Policies**: Implement sequence-aware policies to track aggregate behaviors (e.g., total spend over 24 hours, bulk effects) rather than evaluating single actions in a vacuum.
- [ ] **Harden Default Operators**: Ensure SQL operators use prepared templates (no arbitrary SQL) and FileSystem operators enforce strict size quotas and extension allowlists.

## 📦 Priority 4: Product Maturity
*UX and Developer Experience improvements.*

- [ ] **Human-Readable Approval Dashboard**: Build a React/Next.js frontend that shows a differential view of the exact hashed actions awaiting approval, including blast-radius estimates.
- [ ] **Policy Versioning**: Reference immutable snapshots of Governor policies in execution logs so historical decisions can be audited against the exact policy at that point in time.
- [ ] **Policy Playground**: Create a simulation mode for administrators to test new Governor rules against historical Minister payloads without executing Operators.
- [ ] **Balanced Training Datasets**: Expand the JSONL exporter to include approved actions, human overrides, and corrected replans—not just rejections—to prevent model timidity.
