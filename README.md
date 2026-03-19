# Covernor Platform

**A Governed AI Execution Engine for Enterprise Safety.**

Covernor is a strict, safety-first AI orchestration engine designed to solve the "rogue AI" problem.
In traditional frameworks, the LLM is both the brain and the hands.
In Covernor, the LLM is merely an advisor — every action requires deterministic policy approval and cryptographic authorization before it can execute.

---

## Architecture: The Quadripartite System

```
                ┌──────────────┐
  Objective ───►│   Advisor    │  LLM advisor (GPT-4o / Claude)
                │  (Planner)   │  proposes ProposalJSON — zero execution rights
                └──────┬───────┘
                       ▼
                ┌──────────────┐
                │    Critic    │  Zod SchemaLock validation, prompt-injection defense
                │  (Auditor)   │
                └──────┬───────┘
                       ▼
                ┌──────────────┐
                │  Covernor    │  Deterministic policy engine (no LLMs)
                │  (Firewall)  │  APPROVE · APPROVE_WITH_CONSTRAINTS · BLOCK_AND_ESCALATE · REJECT_AND_REPLAN
                └──────┬───────┘
                       ▼
                ┌──────────────┐
                │   Operator   │  Sandboxed execution, KMS capability-token verification
                │   (Hands)    │  OperatorContracts: maxRowsAffected, requiresIdempotency
                └──────────────┘
```

| Feature | Covernor | LangChain / LlamaIndex | CrewAI / AutoGen |
| :--- | :--- | :--- | :--- |
| **Execution Safety** | Deterministic Firewall & KMS Tokens | Up to the LLM | Up to the LLM |
| **AI Component** | Swappable / Advisory Only | Graph / Chain based | Swarm intelligence |
| **Failure Handling** | Suggest & Retry UX / Rollbacks | Try-Catch blocks | Agent Debate |
| **Auditability** | Cryptographic hash-chain logs | Basic Logging | Basic Logging |
| **Enterprise UX** | K-of-N Human Dual Approval UI | N/A | Variable |

---

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **Redis** — local, Homebrew, or Docker (`docker run -d -p 6379:6379 redis`)

### One-command setup

```bash
git clone https://github.com/denial-web/covernor-platform.git
cd covernor-platform
npm run setup
```

This installs all dependencies (backend + frontend), creates your `.env` file, generates the Prisma client, pushes the database schema, and checks that Redis is reachable.

### Run

```bash
npm run dev
```

This starts both the **backend** (Express + BullMQ, port 3000) and **frontend** (React + Vite, port 5173) in a single terminal.

Open **http://localhost:5173** to see the Covernor Approval Console.

### Try the demo

```bash
npm run demo-escalation
```

This injects a high-risk "Transfer Funds" task that the Covernor will `BLOCK_AND_ESCALATE`.
Open the Approval Console, inspect the rejection reason, and click **Approve Override** to watch a cryptographic capability token get minted.

### Configure an LLM (optional)

The platform works out of the box with a **mock strategy** — no API keys needed.

To connect a real LLM, either:

1. **UI** — click "LLM Settings" in the Approval Console and pick your provider
2. **`.env`** — set the relevant variables:

```bash
# Cloud APIs
ACTIVE_LLM_PROVIDER="openai"        # or "anthropic"
OPENAI_API_KEY="sk-..."

# Local LLM (Ollama)
ACTIVE_LLM_PROVIDER="ollama"
LLM_MODEL="llama3"                   # any model from `ollama list`

# Any OpenAI-compatible server (LM Studio, vLLM, LocalAI, etc.)
ACTIVE_LLM_PROVIDER="custom"
LLM_BASE_URL="http://localhost:1234/v1"
LLM_MODEL="my-model"
```

---

## Project Structure

```
├── src/
│   ├── api/              # Express routes, controllers, middleware
│   ├── config/           # policies.json, operator contracts
│   ├── core/
│   │   ├── minister/     # Advisor: LLM planner + provider adapters (OpenAI, Anthropic)
│   │   ├── critic/       # Critic: Zod schema-lock validation
│   │   ├── governor/     # Covernor: Deterministic policy engine
│   │   ├── operator/     # Sandboxed executor + tool implementations
│   │   ├── workflow/     # BullMQ orchestration coordinator
│   │   ├── policy/       # Capability registry + KMS token signer
│   │   └── crypto/       # ECDSA signing, encryption, hash-chain audit
│   ├── db/               # Prisma client, audit logger
│   ├── scripts/          # Demo and utility scripts
│   └── workers/          # Background reconciliation, escalation, audit workers
├── approval-console/     # React + Vite frontend
├── docs/                 # Architecture, interfaces, design docs
├── prisma/               # Schema and migrations
└── sandbox/              # Runtime audit snapshots (gitignored)
```

---

## Configuration

### Policies

`src/config/policies.json` defines deterministic Covernor rules (spend limits, blocked operations, escalation thresholds).

### LLM Providers

LLM keys can be configured via environment variables **or** through the Settings UI in the Approval Console (stored in the database as `SystemSettings`).
When no valid key is available, the Advisor falls back to a mock strategy so the pipeline keeps running.

### Capability Tokens

See `src/core/policy/capability.registry.ts` for how approved actions are bound to single-use, ECDSA-signed, TTL-limited tokens that the Operator must verify before execution.

---

## Full Setup Guide

See **[docs/SETUP.md](./docs/SETUP.md)** for the complete installation and setup guide, including:
- Step-by-step prerequisites for macOS, Linux, and Windows (WSL)
- Connecting local LLMs (Ollama, LM Studio, vLLM)
- Customizing Covernor policies
- Troubleshooting common issues

---

## Contributing

1. Fork the repo and create your branch from `main`
2. Make your changes and ensure `npm test` passes
3. Open a pull request

---

## License

[MIT](./LICENSE)
