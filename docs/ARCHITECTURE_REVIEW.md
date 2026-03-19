# 🏛️ Minister-Governor Platform: Architectural Review Guide

This document is designed to provide a comprehensive, deeply technical overview of the **Minister-Governor Agentic SaaS Platform**. 

Please review this architecture for security, scalability, LLM reliability, and overall system design.

---

## 📖 1. Core Philosophy

Unlike typical LLM agent frameworks (like LangChain or AutoGPT) that give a single LLM loop direct, unbounded access to tools, this platform enforces a strict separation of concerns using a **Bicameral (Two-Chamber)** architecture. 

It guarantees enterprise safety by separating the *Intelligence* (LLM) from the *Authority* (Deterministic Code).

1. **Minister (Planner)**: An LLM that translates natural language objectives into structured JSON proposals. It *cannot* execute any actions. It can only propose them.
2. **Critic (Self-Reflection)**: A fast, lightweight LLM gatekeeper that intercepts the Minister’s proposal to catch obvious hallucinated tool calls or missing parameters before heavy processing.
3. **Governor (Risk Engine)**: A deterministic, math-driven TypeScript rules engine. It evaluates the Proposal against strict JSON/TypeScript policies (e.g., limits, access lists). It does not use AI. It either `APPROVES`, `REJECT_AND_REPLANS`, or `BLOCK_AND_ESCALATES`.
4. **Operator (Executor)**: The execution sandbox. Only proposals explicitly signed by the Governor can be executed here. Contains concrete tools (PostgreSQL, HTTPS, FileSystem, Slack).

---

## 🏗️ 2. The Execution Workflow (Coordinator Loop)

When a new Task is ingested, it enters the `WorkflowCoordinator`:

1. **Planning**: 
   - Extract `Objective` -> Pass to `MinisterService`.
   - Minister generates a `Proposal` (containing an `actionType` and JSON `parameters`).
2. **Sanity Check**:
   - Proposal passes to `CriticService`.
   - If flawed (e.g., missing parameters, invalid action), it is immediately rejected, sending a feedback string back to the Minister for a Retry.
3. **Evaluation**:
   - If Critic passes, Proposal moves to `GovernorService`.
   - Governor evaluates the payload against deterministic policies.
   - If safe, returns `APPROVE_WITH_CONSTRAINTS`.
   - If unsafe but fixable, returns `REJECT_AND_REPLAN`. The Workflow loop captures this rejection and prompts the Minister to try again. (Max 3 replans).
   - If critically unsafe (e.g., $1,000 refund), returns `BLOCK_AND_ESCALATE`.
4. **Execution or Escalation**:
   - If Approved -> `OperatorService` executes the payload using Sandboxed Tools.
   - If Escalated -> Workflow pauses. Task status updates to `AWAITING_HUMAN`.
5. **Observability**:
   - Every step, decision, and payload is logged immutably into an `AuditLog`.

---

## 🗄️ 3. Database Schema (Prisma / SQL)

The platform is heavily stateful to allow for async human escalations and complex auditing.

| Model | Description |
|---|---|
| `Task` | Represents the top-level User Request. Contains natural language `objective` and `status` (`PENDING`, `COMPLETED`, `FAILED`, `AWAITING_HUMAN`). |
| `Proposal` | Created by the Minister. Belongs to a Task. Contains the raw LLM JSON payloads (`recommendedOption`), and `contextSignals`. |
| `Decision` | Created by the Governor. Belongs to a Proposal. Contains `decisionType` (e.g., `APPROVED`, `ESCALATE`), and the deterministic `policyResults`. |
| `ExecutionReport` | Created by the Operator. Belongs to a Decision. Captures execution status and runtime errors. |
| `AuditLog` | Global event log capturing exhaustive JSON snapshots of every pipeline stage. |

---

## 📡 4. Webhook Ingestion (Phase 1)

The platform currently operates as a social-media listening SaaS.
- **Endpoint**: `POST /api/webhooks/meta`
- **Logic**: Receives Meta Graph API payloads (e.g., a Facebook Page Comment).
- **Security**: Verifies the `x-hub-signature-256` HMAC-SHA256 signature using the `META_APP_SECRET`.
- **Parsing**: A mapper reads the Facebook comment (e.g., *"Where is my order?"*) and translates it into a formal Task `objective`: *"Process customer inquiry regarding order status for User Sokha..."*

---

## 🧑‍⚖️ 5. Human-in-the-Loop Escalations (Phase 2)

If the Governor catches a high-risk policy violation (e.g., `POL_03_REQUIRE_HUMAN_APPROVAL` triggers because a financial transaction exceeds $500), it escalates:

- The Workflow loop mathematically pauses.
- The Task enters `AWAITING_HUMAN`.
- **Dashboard API**: A human manager reviews the blocked proposal via the frontend and can hit `POST /api/decisions/:id/override`.
- This API forces a `HUMAN_OVERRIDE_APPROVED` status into the decision log and immediately resumes `OperatorService` execution, picking up exactly where the pipeline froze.

---

## 📊 6. Observability & Telemetry (Phase 3)

- **JSON Winston Logger**: Global `console.logs` are banned. Everything passes through a structured `Winston` instance formatting telemetry as JSON for Datadog or ELK.
- **Platform Metrics API**: The `GET /api/metrics` endpoint queries Prisma natively to aggregate system load.
  - Aggregates Tasks completed vs. Failed.
  - Generates ratios of Governor Rejections vs Escalations.
  - Calculates rolling execution latency across the entire LLM pipeline.

---

## 🛠️ 7. Sandbox Ecosystem (Phase 4)

The `OperatorService` acts as a highly constrained generic tool dispatcher. Natively, it implements:
- `HTTPOperator`: Generic Axios REST client.
- `PostgreSQLOperator`: Read/Write tool for structured data.
- `FileSystemOperator`: Reads/Writes local file artifacts (hardcoded absolutely to a `/sandbox` directory, preventing `../../` traversal).
- `SlackOperator`: Posts HTTPS notifications strictly to verified `.slack.com` webhook domains.
- `ZendeskOperator` (Mock): Generates/Resolves IT Support tickets.

Every Operator implements an `OperatorContract` guaranteeing max execution time loops (e.g., 5000ms timeout) and idempotency enforcement.

---

## 🧠 8. Scale Phase: Learning Loops (Phase 5)

To prevent the LLM (`Minister`) from continuously making the same mistakes and wasting Governor cycles, we implemented a data feedback loop:

- **JSONL Dataset Exporter (`GET /api/training/dataset`)**: A dedicated API that queries the DB for all `REJECT_AND_REPLAN` and `BLOCK_AND_ESCALATE` decisions.
- It extracts the original `Task.objective`, the flawed `Proposal` JSON, and the correcting constraint requirement.
- It formats this pair into strict JSON Lines format (`.jsonl`), ready to be imported directly into OpenAI/Gemini for LLM Fine-Tuning jobs.
- **Benefit**: Over time, your Minister LLM learns your proprietary Governor rules natively.

---

## 💡 Prompt for ChatGPT / Claude:

**"I am building an enterprise Agentic SaaS platform. Please review the architectural breakdown above. Specifically:*

1. *Are there any vulnerabilities in the separation of concerns between the Minister (LLM) and Governor (Code)?*
2. *Is the database schema sufficient to support long-running, asynchronous LLM workflows that require human-in-the-loop intervention?*
3. *What are the potential failure points in the Webhook parsing and execution loop?*
4. *How would you rate the readiness of this architecture for securing a production LLM system from Prompt Injections or unauthorized tool mutation?"*
