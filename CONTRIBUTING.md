# Contributing to Covernor

Thanks for your interest in contributing. This project governs AI execution in high-stakes environments, so we care about correctness, security, and clarity.

## Getting Started

1. Fork the repo and clone your fork
2. Run `npm run setup` to initialize everything
3. Run `npm run dev` to start the development servers
4. Run `npm test` to verify tests pass

## Development Workflow

1. Create a branch from `main` (`git checkout -b feature/my-change`)
2. Make your changes
3. Run `npx tsc --noEmit` — no TypeScript errors allowed
4. Run `npm test` — all tests must pass
5. Open a pull request against `main`

## What We're Looking For

### High Impact

- **PostgreSQL adapter** — Replace SQLite with PostgreSQL for production use
- **Operator tools** — New tool implementations (Stripe, Twilio, S3, etc.) following the `BaseToolAdapter` interface
- **Test coverage** — Unit tests for services, integration tests for API endpoints, security-focused tests
- **Documentation** — Setup guides for different environments, architecture explanations, API examples

### Always Welcome

- Bug fixes with reproduction steps
- Security improvements (please report vulnerabilities privately — see below)
- Performance improvements with benchmarks
- Typo and documentation fixes

## Code Standards

- **TypeScript** — All code is TypeScript. No `any` types unless unavoidable (and add a comment explaining why).
- **Imports** — Keep imports at the top of the file. No inline `require()` or dynamic `import()` unless necessary for lazy loading.
- **Error handling** — Fail closed. If in doubt, reject/block/escalate rather than allow.
- **Comments** — Only for non-obvious intent. Don't narrate what the code does.
- **Tests** — New features should include tests. Bug fixes should include a regression test.

## Security

If you find a security vulnerability, **do not open a public issue**. Email the maintainers or use GitHub's private vulnerability reporting feature. We take security seriously — this project is designed for regulated environments.

## Pull Request Guidelines

- Keep PRs focused. One concern per PR.
- Include a clear description of what changed and why.
- Reference any related issues.
- Ensure CI passes before requesting review.

## Questions?

Open a [discussion](https://github.com/denial-web/covernor-platform/discussions) or an issue tagged `question`.
