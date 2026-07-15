# Development Handoff

## Current state

Phase 0 (repository foundation and contracts) is complete on `main`. The implementation plan is the authoritative progress tracker: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

Committed implementation: `e0bad10` (`chore: establish typed workspace foundation`). This handoff and the plan progress update are the next documentation commit.

## What was decided

- Use a TypeScript npm-workspaces monorepo: `apps/api`, `apps/mobile`, and `packages/contracts` share one source of truth for runtime-validated data. This avoids duplicated client/API types and lets both applications compile against the same Zod contracts.
- Keep the solution local-first: later phases will use file-backed PGlite and local media. No hosted database or Docker is required.
- Keep AI providers server-side. xAI/Grok is the initial provider; OpenAI, Anthropic, and Gemini will be added behind a provider interface in a later phase.
- Do not train a model. A future local Hugging Face/Transformers.js detector will provide generic shelf-supporting evidence, not SKU truth.
- Treat model output as observations, then ground it against the account catalog. A confirmed out-of-stock finding requires complete coverage and evidence; absence alone is not proof.

## Phase 0 delivered

| Area                | Location                                                                      | Result                                                                                             |
| ------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Workspace tooling   | `package.json`, `tsconfig.base.json`, `eslint.config.mjs`, `vitest.config.ts` | Node 22.16.0 npm workspace setup with root quality commands.                                       |
| Shared contracts    | `packages/contracts/src/`                                                     | Shared enums, evidence references, claims, raw AI observations, and final audit schema.            |
| Contract tests      | `packages/contracts/test/schemas.test.ts`                                     | Valid data plus invalid bounds, inverted boxes, invalid confidence, and unsafe OOS cases.          |
| App boundaries      | `apps/api`, `apps/mobile`                                                     | Minimal typed workspaces importing the shared contract package.                                    |
| Local configuration | `.env.example`, `.gitignore`, `.nvmrc`, `README.md`                           | Provider-key placeholders, ignored local data/media, tested runtime, and Windows command guidance. |

The `Claim` schema encodes both output shape and decision discipline: only `observed` or `inferred` claims can carry a value, and confidence must match its declared band. Media paths must be relative and cannot escape the media directory.

## TDD evidence

The contract test file was written and run before its implementation. The initial run failed because the contracts entry point did not yet exist. After the schema implementation:

```powershell
npm.cmd test
# 1 test file passed; 5 tests passed

npm.cmd run check
# Prettier, ESLint, TypeScript (contracts/API/mobile), and Vitest all passed
```

Run `npm.cmd run check` after every phase. Use `npm.cmd`, not `npm`, in this PowerShell environment because execution policy blocks `npm.ps1`.

## Next phase: local persistence, account context, and media storage

Follow Phase 1 in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). Start test-first:

1. Write repository/migration tests for a fresh temporary PGlite database, idempotent seeds, and valid audit-run transitions.
2. Add file-backed PGlite under ignored `data/pgdata` and SQL migrations for accounts, catalog products, account assortments, and audit runs.
3. Seed a small demo catalog tied to the available test recording, then implement repositories that return only active, account-scoped products.
4. Add local media storage with a MIME/type and size allowlist plus protected relative paths.
5. Run the Phase 1 test gate and `npm.cmd run check`, then append the results here before moving to Phase 2.

## Operational notes and gotchas

- Node is pinned to `22.16.0` in `.nvmrc`; use a matching Node 22 runtime.
- `npm.cmd install` may need elevated sandbox permission in this environment because npm accesses its registry/cache. Dependencies are currently installed and the lockfile is committed.
- Git may warn that the global ignore file under `C:\Users\dhair\.config\git\ignore` is inaccessible. It does not affect this repository.
- Git metadata writes and pushing require elevated sandbox permission. `main` tracks `origin/main`; the historical remote `master` branch is intentionally untouched.
- Do not place actual API keys in `.env.example` or commit a `.env` file.

## Resume checklist

1. Check `git status --short --branch`.
2. Read the current phase and its test gate in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).
3. Write the next failing tests first, implement only enough to make them pass, then run `npm.cmd run check`.
4. Update this document and the plan checkboxes only after the phase passes, then commit and push to `main`.
