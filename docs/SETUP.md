# Installation & Setup Guide

This guide walks you through installing and running the Covernor Platform from scratch on **macOS**, **Linux**, or **Windows (WSL)**.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Running the Platform](#running-the-platform)
5. [Connecting an LLM](#connecting-an-llm)
   - [No LLM (Mock Mode)](#no-llm-mock-mode)
   - [OpenAI](#openai)
   - [Anthropic (Claude)](#anthropic-claude)
   - [Ollama (Local LLM)](#ollama-local-llm)
   - [Custom OpenAI-Compatible Server](#custom-openai-compatible-server)
6. [Trying the Demo](#trying-the-demo)
7. [Customizing Policies](#customizing-policies)
8. [Available Scripts](#available-scripts)
9. [Project Layout](#project-layout)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Dependency | Version | Why |
|---|---|---|
| **Node.js** | >= 18 | Runtime for the backend and build tools |
| **npm** | >= 9 (ships with Node) | Package management |
| **Redis** | >= 6 | Required by BullMQ for job orchestration |

### Installing Node.js

**macOS (Homebrew):**
```bash
brew install node
```

**Ubuntu / Debian:**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

**Windows:** Use [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install) and follow the Ubuntu instructions, or install from [nodejs.org](https://nodejs.org/).

### Installing Redis

**macOS (Homebrew):**
```bash
brew install redis
brew services start redis
```

**Ubuntu / Debian:**
```bash
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
```

**Docker (any OS):**
```bash
docker run -d --name redis -p 6379:6379 redis
```

Verify Redis is running:
```bash
redis-cli ping
# Should print: PONG
```

---

## Installation

### Quick setup (recommended)

```bash
git clone https://github.com/denial-web/covernor-platform.git
cd covernor-platform
npm run setup
```

This single command:
1. Creates `.env` from `.env.example` (if it doesn't exist)
2. Installs backend dependencies (`npm install`)
3. Installs frontend dependencies (`approval-console/`)
4. Generates the Prisma client
5. Creates the SQLite database and pushes the schema
6. Checks that Redis is reachable

### Manual setup (if you prefer step-by-step)

```bash
# 1. Clone
git clone https://github.com/denial-web/covernor-platform.git
cd covernor-platform

# 2. Environment
cp .env.example .env

# 3. Backend dependencies
npm install

# 4. Frontend dependencies
cd approval-console
npm install
cd ..

# 5. Database
npx prisma generate
npx prisma db push

# 6. Verify Redis
redis-cli ping
```

---

## Configuration

All configuration lives in the `.env` file at the project root. The defaults work out of the box for local development — you only need to change things if you want to connect a real LLM or use a non-default Redis host.

### Required settings (already set by `npm run setup`)

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `file:./dev.db` | SQLite database path (no external DB needed) |
| `ADMIN_API_KEY` | `development_admin_key` | Shared key between frontend and backend |

### Optional settings

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Backend HTTP port |
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `ACTIVE_LLM_PROVIDER` | `openai` | Which LLM to use: `openai`, `anthropic`, `ollama`, or `custom` |
| `OPENAI_API_KEY` | — | Your OpenAI API key |
| `ANTHROPIC_API_KEY` | — | Your Anthropic API key |
| `LLM_MODEL` | — | Override the default model name |
| `LLM_BASE_URL` | — | Override the API endpoint URL |

---

## Running the Platform

### Start everything (one command)

```bash
npm run dev
```

This launches both servers in a single terminal:
- **Backend** (Express + BullMQ workers) on `http://localhost:3000`
- **Frontend** (React + Vite) on `http://localhost:5173`

Open **http://localhost:5173** in your browser to see the Covernor Approval Console.

### Start servers separately (if you prefer two terminals)

```bash
# Terminal 1 — Backend
npm run start:dev

# Terminal 2 — Frontend
cd approval-console
npm run dev
```

### Verify it's working

```bash
curl http://localhost:3000/health
# Should return: {"status":"ok"}
```

---

## Connecting an LLM

The platform supports four LLM configurations. You can set them via **environment variables** (`.env` file) or through the **Settings UI** in the Approval Console (click the "LLM Settings" button in the top-right).

Settings saved through the UI are encrypted (AES-256) and stored in the database. They take priority over environment variables.

### No LLM (Mock Mode)

This is the default. When no LLM keys are configured, the Advisor uses a built-in mock strategy that returns sensible test data. The full pipeline still runs — Covernor evaluation, escalation, tokens, audit — everything except the actual LLM call.

No configuration needed. Just run `npm run dev`.

### OpenAI

```bash
# .env
ACTIVE_LLM_PROVIDER="openai"
OPENAI_API_KEY="sk-..."
LLM_MODEL="gpt-4o-mini"          # optional, this is the default
```

Or enter your key in the Approval Console under LLM Settings.

### Anthropic (Claude)

```bash
# .env
ACTIVE_LLM_PROVIDER="anthropic"
ANTHROPIC_API_KEY="sk-ant-..."
LLM_MODEL="claude-3-haiku-20240307"   # optional, this is the default
```

### Ollama (Local LLM)

[Ollama](https://ollama.com/) lets you run LLMs locally with zero cloud costs.

**Step 1: Install Ollama**

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

**Step 2: Pull a model**

```bash
ollama pull llama3
```

Other good options: `mistral`, `codellama`, `gemma2`, `phi3`. See the full list at [ollama.com/library](https://ollama.com/library).

**Step 3: Start the server**

```bash
ollama serve
```

**Step 4: Configure the platform**

```bash
# .env
ACTIVE_LLM_PROVIDER="ollama"
LLM_MODEL="llama3"                    # must match what you pulled
# LLM_BASE_URL="http://localhost:11434/v1"   # default, only change if you customized Ollama's port
```

Or select "Ollama (Local)" from the provider dropdown in the Approval Console settings.

### Custom OpenAI-Compatible Server

This works with **LM Studio**, **vLLM**, **LocalAI**, **text-generation-webui**, or any server that exposes an OpenAI-compatible `/v1/chat/completions` endpoint.

```bash
# .env
ACTIVE_LLM_PROVIDER="custom"
LLM_BASE_URL="http://localhost:1234/v1"   # your server's URL
LLM_MODEL="my-model-name"                 # the model identifier your server expects
OPENAI_API_KEY="not-needed"               # some servers require a dummy key
```

**Example: LM Studio**
1. Open LM Studio, load a model
2. Start the local server (it defaults to port 1234)
3. Set `LLM_BASE_URL="http://localhost:1234/v1"` and `LLM_MODEL` to the model you loaded

---

## Trying the Demo

With the platform running (`npm run dev`), open a new terminal:

```bash
npm run demo-escalation
```

This script:
1. Creates a task: *"Issue a $1,000 refund to user account 4492"*
2. The Advisor proposes a `TRANSFER_FUNDS` action with `amount: 1000`
3. The Covernor evaluates it against `policies.json` — Policy `POL_03` requires human approval for transfers over $500
4. The Covernor issues a `BLOCK_AND_ESCALATE` decision
5. The task appears in the Approval Console with status `AWAITING_HUMAN`

**In the browser (http://localhost:5173):**
1. Click the pending task in the left panel
2. Review the Advisor's proposal payload and the Covernor's rejection reason
3. Click **Approve Override**
4. A cryptographic capability token is minted and the task completes

---

## Customizing Policies

Covernor policies are defined in `src/config/policies.json`. Each policy has:

| Field | Description |
|---|---|
| `id` | Unique identifier (e.g. `POL_03_REQUIRE_HUMAN_APPROVAL`) |
| `targetActionTypes` | Which action types this policy evaluates |
| `ruleType` | `DENY` (block), `CONSTRAINT` (inject limits), `ESCALATE` (require human), `DUAL_APPROVAL` (K-of-N) |
| `conditions` | Parameter checks (CONTAINS, GREATER_THAN, etc.) |
| `riskLevel` | LOW, MEDIUM, HIGH, CRITICAL |

**Example — lower the escalation threshold to $100:**

Edit `src/config/policies.json`, find `POL_03_REQUIRE_HUMAN_APPROVAL`, and change:
```json
"value": 500
```
to:
```json
"value": 100
```

Restart the backend (`npm run dev`) and all transfers over $100 will now require human approval.

---

## Available Scripts

| Command | What it does |
|---|---|
| `npm run setup` | Full first-time setup (env, deps, database, Redis check) |
| `npm run dev` | Start backend + frontend in one terminal |
| `npm run start:dev` | Start backend only (with auto-reload) |
| `npm run start:frontend` | Start frontend only |
| `npm run demo-escalation` | Inject a high-risk task to test the escalation flow |
| `npm run demo` | Run the original P0 demo scenarios |
| `npm run invoke-webhook` | Send a mock Meta webhook to the API |
| `npm test` | Run the test suite (Jest) |

---

## Project Layout

```
covernor-platform/
├── scripts/
│   └── setup.sh               # Automated setup script
├── src/
│   ├── api/                    # Express routes, controllers, auth middleware
│   ├── config/
│   │   └── policies.json       # Covernor policy rules (edit this!)
│   ├── core/
│   │   ├── minister/           # LLM planner
│   │   │   ├── providers/      # OpenAI, Anthropic, Ollama adapters
│   │   │   └── llm.provider.ts # Provider factory (reads DB settings + env)
│   │   ├── critic/             # Zod schema-lock validation
│   │   ├── governor/           # Deterministic policy engine
│   │   ├── operator/           # Sandboxed executor + tool registry
│   │   ├── workflow/           # BullMQ orchestration coordinator
│   │   ├── policy/             # Capability registry + KMS tokens
│   │   └── crypto/             # ECDSA signing, AES encryption, hash-chain
│   ├── db/                     # Prisma client, audit logger
│   ├── scripts/                # Demo and utility scripts
│   ├── workers/                # Background jobs (reconciliation, escalation, audit)
│   └── server.ts               # Express entrypoint
├── approval-console/           # React + Vite frontend (Approval Console)
├── docs/                       # Architecture and design documents
├── prisma/
│   └── schema.prisma           # Database schema
├── .env.example                # Template for environment variables
├── package.json                # Scripts, dependencies
└── tsconfig.json               # TypeScript configuration
```

---

## Troubleshooting

### "Cannot connect to Redis"

The backend checks for Redis on startup. If you see this error:

```
Cannot connect to Redis at localhost:6379.
```

Make sure Redis is running:
```bash
redis-cli ping    # should print PONG
```

If not installed, see [Installing Redis](#installing-redis) above.

If Redis is on a different host or port, set `REDIS_HOST` and `REDIS_PORT` in `.env`.

### "Unauthorized: Invalid API Key"

The frontend sends `development_admin_key` as the API key by default. Make sure your `.env` has:

```bash
ADMIN_API_KEY="development_admin_key"
```

If you change this value, also update the frontend by setting `VITE_API_KEY` in `approval-console/.env`:

```bash
VITE_API_KEY="your_new_key"
```

### "Argument contextSignals is missing"

This was a known bug that has been fixed. If you hit this, make sure you're on the latest version of the codebase.

### Tasks stay PENDING and never process

1. Check that Redis is running (`redis-cli ping`)
2. Check the backend terminal for errors
3. Make sure no stale Node/Jest processes are competing for the BullMQ queue:
```bash
# Find stale processes
ps aux | grep node
# Kill any leftover test runners or old server instances
```

### LLM calls fail but the system still works

This is by design. When the LLM call fails (bad key, network timeout, model not found), the Advisor falls back to a mock strategy. The full pipeline keeps running. Check the backend logs for a warning like:

```
[Advisor] LLM call failed, falling back to mock strategy.
```

To fix: verify your API key or local LLM server is working via the "Test Connection" button in the LLM Settings UI.

### Ollama "Connection refused"

Make sure Ollama is actually serving:
```bash
ollama serve
```

And that you've pulled the model you configured:
```bash
ollama list              # see what's available
ollama pull llama3       # pull if missing
```

### Frontend shows a blank page

1. Make sure the frontend dev server is running (port 5173)
2. The frontend proxies `/api` requests to `http://localhost:3000` — make sure the backend is also running
3. Check the browser console (F12) for errors

### Reset the database

If you want to start fresh:
```bash
rm dev.db
npx prisma db push
```

This creates a new empty database with the current schema.
