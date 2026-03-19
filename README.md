# Covernor — AI Governance Layer

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

**Control what AI is allowed to *do* — not just what it says.**

---

## Why This Exists

AI agents are unsafe without execution control. LangChain, CrewAI, and AutoGen let LLMs call tools directly — the AI is both the brain and the hands. One hallucinated function call can delete a database, transfer funds to the wrong account, or leak customer data.

Covernor separates **planning** from **execution**. The AI proposes. A deterministic policy engine decides. Cryptographic tokens authorize. Humans approve what matters. Everything is audit-logged.

---

## How It Works

```
              ┌──────────────┐
 Objective ──►│   Advisor    │  LLM (GPT-4o / Claude / Ollama / any)
              │              │  Proposes actions — zero execution rights
              └──────┬───────┘
                     ▼
              ┌──────────────┐
              │    Critic    │  Blocks prompt injection, SQL injection,
              │              │  data exfiltration before it reaches policy
              └──────┬───────┘
                     ▼
              ┌──────────────┐
              │  Covernor    │  Deterministic policy engine (no LLM)
              │              │  APPROVE · CONSTRAIN · ESCALATE · REJECT
              └──────┬───────┘
                     ▼
              ┌──────────────┐
              │   Operator   │  Sandboxed execution with capability tokens
              │              │  Single-use, TTL-bound, ECDSA-signed
              └──────────────┘
```

The LLM never touches the execution layer. The Covernor never uses an LLM. This separation is the core security guarantee.

---

## Core Features

| Feature | What It Does |
|---|---|
| **Policy Engine (Default Deny)** | JSON-configurable rules. Unknown actions are blocked, not allowed. No LLM in the decision path. |
| **Capability Tokens (ECDSA)** | Every approved action gets a single-use, TTL-bound, scope-bound cryptographic token. The Operator won't execute without one. |
| **Dual Approval (K-of-N)** | High-risk actions require multiple human approvers. Anti-self-dealing — same person can't approve twice. |
| **Hash-Chain Audit Log** | SHA-256 chained, append-only, tamper-evident. Every decision, approval, and execution is recorded with full context. |
| **Velocity Limiting** | Per-tenant and per-recipient rate guards. Atomic Redis Lua scripts. Fails closed if Redis is down. |
| **Critic Layer** | Deterministic pattern detection for SQL injection, prompt injection, data exfiltration, and sensitive data leakage. |
| **Operator Contracts** | Each tool declares max execution time, max rows, rate limits, and required idempotency. Enforced at runtime. |
| **RBAC** | JWT + DB-backed roles (admin, approver, viewer, operator). No self-declared privileges. |
| **LLM Flexibility** | Swap providers via UI or env vars. Supports OpenAI, Anthropic, Ollama, LM Studio, vLLM, or any OpenAI-compatible API. Works without any LLM (mock mode). |

---

## Example: AI Refund System

A bank deploys an AI assistant that can issue refunds:

```
Customer: "I was charged twice for order #4521"
```

| Amount | Covernor Decision | What Happens |
|---|---|---|
| $12 | `APPROVE` | Refund executes automatically. Audit logged. |
| $250 | `APPROVE_WITH_CONSTRAINTS` | Refund executes with injected reason code. Manager notified. |
| $5,000 | `BLOCK_AND_ESCALATE` | Blocked. Two managers must approve in the console. 4-hour expiry. |
| $50,000 | `REJECT` | Hard reject. Velocity limit triggered. Flagged for review. |

The AI never decides the outcome. The policy engine does.

---

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **Redis** — `brew services start redis` / `docker run -d -p 6379:6379 redis`

### Setup & Run

```bash
git clone https://github.com/denial-web/covernor-platform.git
cd covernor-platform
npm run setup    # install deps, create .env, init database
npm run dev      # starts backend (port 3000) + frontend (port 5173)
```

Open **http://localhost:5173** → Covernor Approval Console.

### Try the Demo

```bash
npm run demo-escalation
```

Injects a high-risk "Transfer $15,000" task. Watch it get blocked, inspect the rejection reason in the console, and click **Approve Override** to see a capability token get minted.

### Connect an LLM (Optional)

Works out of the box with a mock strategy. To use a real LLM:

```bash
# Cloud
ACTIVE_LLM_PROVIDER="openai"      # or "anthropic"
OPENAI_API_KEY="sk-..."

# Local (Ollama)
ACTIVE_LLM_PROVIDER="ollama"
LLM_MODEL="llama3"

# Any OpenAI-compatible server
ACTIVE_LLM_PROVIDER="custom"
LLM_BASE_URL="http://localhost:1234/v1"
LLM_MODEL="my-model"
```

Or configure via the **LLM Settings** panel in the Approval Console UI.

---

## Comparison

| | Covernor | LangChain / LlamaIndex | CrewAI / AutoGen |
|---|---|---|---|
| **Execution Safety** | Deterministic firewall + crypto tokens | Up to the LLM | Up to the LLM |
| **AI Role** | Advisory only, swappable | Core orchestrator | Swarm intelligence |
| **Failure Handling** | Retry + rollback + human escalation | Try-catch | Agent debate |
| **Audit Trail** | Cryptographic hash-chain | Basic logging | Basic logging |
| **Human Oversight** | K-of-N dual approval UI | N/A | Variable |
| **Vendor Lock-in** | None (self-hosted, open-source) | Framework-dependent | Framework-dependent |

---

## Production Readiness

> **Honest status: This is a governance framework, not a turnkey product.**

### What's real and working
- Deterministic policy engine with default-deny
- ECDSA capability tokens (single-use, TTL-bound)
- Hash-chain audit logs with financial fields
- K-of-N dual approval with anti-replay
- Redis velocity limiting (fails closed)
- JWT + RBAC authentication
- SQL/prompt injection detection
- Operator contract enforcement
- 43 security fixes across 6 audit rounds

### What's still development-stage
- SQLite database (swap to PostgreSQL for production)
- In-memory crypto keys (integrate real KMS/HSM for production)
- Mock payment execution (integrate your payment gateway)
- Minimal test suite (needs comprehensive coverage)
- No TLS configuration (add via reverse proxy or config)

### What you'd add for regulated industries
- Enterprise identity (OIDC/SAML + MFA)
- HSM-backed key management (AWS KMS, Vault)
- Database encryption at rest
- Third-party penetration testing
- Compliance documentation (SOC 2, FedRAMP)

See [docs/UPGRADE_PLAN.md](./docs/UPGRADE_PLAN.md) for the full production roadmap.

---

## Roadmap

| Version | Focus | Status |
|---|---|---|
| **v0.1** | Core governance engine, policy engine, capability tokens, dual approval, audit chain | Current |
| **v0.2** | PostgreSQL migration, OpenTelemetry, structured logging, API versioning | Planned |
| **v0.3** | Enterprise identity (OIDC/SAML), KMS integration, field-level encryption | Planned |
| **v0.4** | Agent memory, learning loops, fine-tuning pipeline, plugin system | Planned |

---

## Project Structure

```
├── src/
│   ├── api/              # Express routes, auth, rate limiting, RBAC
│   ├── core/
│   │   ├── minister/     # Advisor: LLM planner + provider adapters
│   │   ├── critic/       # Injection detection + schema validation
│   │   ├── governor/     # Deterministic policy engine
│   │   ├── operator/     # Sandboxed executor + tool implementations
│   │   ├── workflow/     # BullMQ orchestration coordinator
│   │   ├── policy/       # Capability registry
│   │   └── crypto/       # ECDSA signing, AES-256-GCM encryption
│   ├── db/               # Prisma client, hash-chain audit logger
│   └── workers/          # Reconciliation, escalation, audit snapshot
├── approval-console/     # React + Vite frontend
├── docs/                 # Architecture, setup guide, upgrade plan
├── prisma/               # Database schema
└── tests/                # Unit and integration tests
```

---

## Documentation

- **[Setup Guide](./docs/SETUP.md)** — Full installation for macOS, Linux, Windows (WSL)
- **[Architecture](./docs/architecture.md)** — System design and data flow
- **[Interfaces](./docs/interfaces.md)** — API contracts and schemas
- **[Upgrade Plan](./docs/UPGRADE_PLAN.md)** — Production roadmap with effort estimates

---

## Contributing

We welcome contributions. See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for guidelines.

The most impactful areas right now:
- PostgreSQL adapter and migration scripts
- Additional operator tools (Stripe, Twilio, AWS)
- Test coverage (unit, integration, security)
- Documentation and examples

---

## License

[MIT](./LICENSE) — Use it, fork it, build on it.
