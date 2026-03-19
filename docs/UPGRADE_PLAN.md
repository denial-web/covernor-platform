# Covernor Platform — Upgrade Plan

## Status: NOT STARTED

This document is the technical specification for upgrading the platform from a single-API governance engine to a multi-channel, shell-adaptable AI execution platform. Any AI agent working on this repo should read this before making architectural changes.

---

## Current Architecture (as-built)

```
[REST API] → [BullMQ Queue] → [Advisor] → [Critic] → [Covernor] → [Operator] → [Tools]
                                                            ↓
                                                   [Human Approval Console]
```

### Existing components (DO NOT modify without reading this plan)

| Component | Path | Purpose |
|---|---|---|
| Advisor | `src/core/minister/` | LLM planner (OpenAI, Anthropic, Ollama, Custom) |
| Critic | `src/core/critic/` | Zod schema-lock validation, hallucination rejection |
| Covernor | `src/core/governor/` | Deterministic policy engine, velocity guards, capability auth |
| Operator | `src/core/operator/` | Sandboxed execution with contracts, rollback, idempotency |
| Policy Engine | `src/core/governor/policies/engine.ts` | Evaluates DENY/CONSTRAINT/ESCALATE/DUAL_APPROVAL rules |
| Capability Registry | `src/core/policy/capability.registry.ts` | Maps capabilities to tools, enforces human review flags |
| KMS Service | `src/core/crypto/kms.service.ts` | ECDSA-signed, single-use, TTL-bound capability tokens |
| Audit Logger | `src/db/audit.logger.ts` | SHA-256 hash-chained append-only ledger |
| Workflow Coordinator | `src/core/workflow/coordinator.service.ts` | BullMQ orchestration with replan loop (max 3 attempts) |
| API Layer | `src/api/` | Express routes, controllers, auth middleware |
| Workers | `src/workers/` | Reconciliation, escalation expiry, audit snapshot |
| Approval Console | `approval-console/` | React + Vite frontend |

### Existing security controls (MUST be preserved)

1. Timing-safe API key auth (`crypto.timingSafeEqual`)
2. Critic schema lock (rejects hallucinated tools)
3. Capability registry gate (unknown tools blocked)
4. Operator contract enforcement (Zod parameter validation)
5. Deterministic policy engine (no LLM in decisions)
6. Redis velocity limiting with atomic Lua scripts (fails closed)
7. ECDSA capability tokens (single-use, 15-min TTL, scope-bound, payload-hash-bound)
8. K-of-N dual approval (anti-self-dealing)
9. SHA-256 hash-chain audit (Serializable isolation)
10. Idempotency enforcement (DB unique constraint + tool-level)

---

## Target Architecture

```
[User / Channel]
       ↓
[Agent Shell Adapter]        ← swappable (webchat, Telegram, OpenClaw, custom)
       ↓
[Interaction Gateway]        ← normalizes requests, binds session/tenant/identity
       ↓
[Advisor]                   ← LLM proposes (unchanged)
       ↓
[Critic]                     ← schema validation (unchanged)
       ↓
[Covernor]                   ← deterministic policy (unchanged)
       ↓
[Operator]                   ← sandboxed execution (unchanged)
       ↓
[Tools / External Systems]
```

### Design principle

> **Shells talk. Core decides. Operators execute.**

No shell may call tools directly. All tool calls pass through the gateway and Covernor. The governed core stays unchanged.

---

## Phase 1: Interface Contracts + Interaction Gateway

### Goal
Extract the current API controller logic into a reusable gateway service. Define the AgentShellAdapter interface.

### Files to create

- `src/core/interfaces/agent-shell.interface.ts` — Shell adapter contract
- `src/core/interfaces/interaction-gateway.interface.ts` — Gateway contract
- `src/core/interfaces/tool-registry.interface.ts` — Expanded capability registry interface
- `src/app/gateway/interaction.gateway.ts` — Gateway implementation (extracted from controllers.ts)

### Key interfaces

```typescript
export interface AgentShellAdapter {
  shellName: string;
  createSession(input: CreateSessionInput): Promise<ShellSession>;
  receiveMessage(input: ShellMessageInput): Promise<ShellMessageResult>;
  streamResponse?(input: ShellMessageInput): AsyncIterable<ShellStreamChunk>;
  listCapabilities(): Promise<ShellCapability[]>;
  closeSession(sessionId: string): Promise<void>;
}

export interface InteractionGateway {
  normalizeIncoming(input: ExternalShellMessage): Promise<NormalizedRequest>;
  buildExecutionContext(req: NormalizedRequest): Promise<ExecutionContext>;
  routeToAdvisor(ctx: ExecutionContext): Promise<GovernedPlan>;
  formatOutgoing(result: GovernedResult, shell: string): Promise<ShellResponse>;
}
```

### Acceptance criteria

- All existing API endpoints continue to work unchanged
- Gateway service can be called by both the existing REST API and new shell adapters
- Zero changes to Advisor, Critic, Covernor, or Operator
- All 10 security controls pass verification

---

## Phase 2: Session Management + Reference Shell (WebChat)

### Goal
Add session tracking and build one reference shell adapter (webchat) that uses the Interaction Gateway.

### Files to create

- `src/core/schemas/session.schema.ts` — Zod schema for sessions
- `src/core/schemas/message.schema.ts` — Zod schema for normalized messages
- `src/adapters/shells/webchat/webchat.adapter.ts` — WebChat shell (wraps existing React app)

### Prisma schema additions

```prisma
model Session {
  id          String   @id @default(uuid())
  tenantId    String
  shellName   String
  userId      String
  metadata    Json?
  expiresAt   DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([tenantId, userId])
  @@index([expiresAt])
}
```

### Acceptance criteria

- Sessions are created and tracked per user per shell
- WebChat adapter creates tasks through the gateway (not directly through API)
- Session expiration worker cleans up stale sessions
- Existing approval console still works

---

## Phase 3: Dual Memory System

### Goal
Add conversational memory (for shell UX) and governed memory (for policy decisions), kept strictly separate.

### Files to create

- `src/core/memory/conversational.memory.ts` — Shell-scoped, session-bound, not used by Covernor
- `src/core/memory/governed.memory.ts` — Write-protected, only Covernor-approved facts
- `src/core/interfaces/memory.interface.ts` — Memory provider interface

### Prisma schema additions

```prisma
model ConversationalMemory {
  id         String   @id @default(uuid())
  sessionId  String
  tenantId   String
  role       String
  content    String
  metadata   Json?
  createdAt  DateTime @default(now())

  @@index([sessionId])
  @@index([tenantId, createdAt])
}

model GovernedMemory {
  id           String   @id @default(uuid())
  tenantId     String
  factType     String
  factContent  Json
  confidence   Float    @default(1.0)
  source       String
  approvedBy   String?
  createdAt    DateTime @default(now())

  @@index([tenantId, factType])
}
```

### Critical constraint

> Conversational memory is NEVER used for Covernor policy decisions. Governed memory is NEVER written by shells directly — only through approved pipeline actions.

### Acceptance criteria

- Conversational memory persists across session turns
- Governed memory stores verified facts (e.g., user identity confirmed)
- Covernor can read governed memory for risk context
- Shell memory injection cannot influence policy decisions

---

## Phase 4: Agent Loop (Multi-Step Governed Execution)

### Goal
Allow shells to submit multi-step objectives where the agent loop proposes, executes, observes, and continues — with every step individually Covernor-evaluated.

### Files to modify

- `src/core/workflow/coordinator.service.ts` — Add loop mode (currently single-pass)

### Key constraints

- Maximum loop steps defined by policy (default: 5)
- Each step is a full Advisor → Critic → Covernor → Operator pass
- Output from step N is NOT trusted as input for step N+1 without re-validation
- Loop can be interrupted by Covernor escalation at any step
- All steps are individually audit-logged

### Acceptance criteria

- Multi-step tasks complete autonomously within Covernor bounds
- Covernor can halt the loop at any step
- Audit trail shows each individual step with its own decision
- Shell receives progress updates per step

---

## Phase 5: Shell-Specific Policies + Second Adapter

### Goal
Extend the policy engine to support per-shell rules. Build a second adapter (Telegram or OpenClaw) to validate the interface is general enough.

### Files to create

- `src/core/policy/shell-policy.service.ts` — Shell policy evaluation
- `src/adapters/shells/telegram/telegram.adapter.ts` — Second shell adapter

### Policy extension (extend existing policies.json, do NOT create separate system)

```json
{
  "shellScopes": {
    "webchat": {
      "allowedToolCategories": ["database.read", "support.zendesk"],
      "maxLoopSteps": 3,
      "autonomousLoop": true
    },
    "telegram": {
      "allowedToolCategories": ["database.read"],
      "maxLoopSteps": 1,
      "autonomousLoop": false
    }
  }
}
```

### Policy precedence order

1. Tenant policy (highest)
2. Shell policy
3. Tool capability registry
4. Covernor decision
5. Operator contract (lowest, always enforced)

### Acceptance criteria

- Different shells have different tool access
- Public shell cannot access financial tools
- Internal shell has broader access
- Same Covernor evaluates all requests regardless of shell
- Policy precedence is deterministic and auditable

---

## Phase 6: Governed Skill / Plugin SDK

### Goal
Allow external skills to be registered with manifests declaring risk level, required approvals, and supported shells. All skill execution goes through Covernor.

### Files to create

- `src/core/interfaces/skill-runtime.interface.ts` — Skill plugin contract
- `src/core/schemas/skill-manifest.schema.ts` — Zod manifest schema
- `src/core/skills/skill-runtime.service.ts` — Skill loader and executor

### Key interfaces

```typescript
export interface SkillManifest {
  name: string;
  description: string;
  category: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  requiresApproval: boolean;
  allowedDataClasses: string[];
  supportedShells: string[];
}

export interface SkillPlugin {
  id: string;
  version: string;
  manifest: SkillManifest;
  handlers: {
    validate(input: unknown): Promise<ValidationResult>;
    execute(input: unknown, ctx: SkillExecutionContext): Promise<SkillExecutionResult>;
  };
}
```

### Acceptance criteria

- Skills register with manifests
- Covernor evaluates skill execution like any other tool
- Skills are scoped to allowed shells and data classes
- Unregistered skills cannot execute

---

## Constraints for ALL phases

1. **Covernor is never bypassed** — every tool/skill execution passes through policy evaluation
2. **Audit chain is never broken** — every action is hash-chain logged
3. **Capability tokens are always required** — no direct tool execution without ECDSA verification
4. **Critic is never skipped** — all LLM output is schema-validated before Covernor
5. **Tenant isolation is maintained** — no cross-tenant data access
6. **Existing API endpoints remain functional** — backward compatibility throughout
7. **TypeScript strict mode** — all new code compiles under `strict: true`
