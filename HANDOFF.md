# Development Handoff

## Current state

Phases 0 and 1 are complete on `main`; Phase 2 (video ingestion and first vertical slice) is next. The implementation plan is the authoritative progress tracker: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

✅ Committed and verified: `e0bad10` (`chore: establish typed workspace foundation`) and `68839bb` (`docs: record phase 0 handoff`).

🔶 Completed and verified but not yet committed: Phase 1 PGlite persistence, local media storage, tests, and this updated handoff/plan record.

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

## Phase 1 delivered

| Area                     | Location                                                           | Result                                                                                                           |
| ------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Embedded database        | `apps/api/src/persistence/database.ts`                             | Creates in-memory PGlite for tests or the ignored `data/pgdata` file-backed instance for local runtime.          |
| Migrations               | `apps/api/src/persistence/migrations.ts`                           | Versioned SQL creates accounts, products, account assortments, audit runs, and indexes.                          |
| Demo context             | `apps/api/src/persistence/seed.ts`                                 | Two demo accounts, three small water products, and expected-assortment examples; inserts are idempotent.         |
| Repository/state machine | `apps/api/src/persistence/audit-repository.ts`, `state-machine.ts` | Account-scoped catalog queries, audit creation, explicit transitions, and safe abandoned-job recovery.           |
| Local media              | `apps/api/src/persistence/media-store.ts`                          | MIME/size allowlist, UUID-generated `uploads/<uuid>.<extension>` paths, and traversal-safe resolution.           |
| Integration tests        | `apps/api/test/persistence.test.ts`                                | Fresh migration, idempotent seed, close/reopen persistence, invalid transition, recovery, and media containment. |

`audit_runs` stores a `source_video_path`, never a video blob. The initial transition graph is linear (`created` through `completed`) with `failed` allowed only from processing states. On startup, callers invoke `recoverAbandonedAudits()`; it marks any nonterminal, non-created audit as `failed` with `ABANDONED_AUDIT`, leaving source media available for a later retry flow.

## TDD evidence

The contract test file was written and run before its implementation. The initial run failed because the contracts entry point did not yet exist. After the schema implementation:

```powershell
npm.cmd test
# 1 test file passed; 5 tests passed

npm.cmd run check
# Prettier, ESLint, TypeScript (contracts/API/mobile), and Vitest all passed
```

For Phase 1, `apps/api/test/persistence.test.ts` was added before the persistence module. Its first run failed with `Cannot find module '../src/persistence/index.js'`. After implementation:

```powershell
npm.cmd run check
# 2 test files passed; 9 tests passed
# Prettier, ESLint, and all three workspace type checks passed
```

Run `npm.cmd run check` after every phase. Use `npm.cmd`, not `npm`, in this PowerShell environment because execution policy blocks `npm.ps1`.

## Next phase: video ingestion and first vertical slice

Follow Phase 2 in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). Start test-first:

1. Add failing Fastify integration tests for health, account list, audit status, invalid upload, and failed-stage behavior before creating the server.
2. Introduce FFmpeg/ffprobe behind an interface with a configurable binary path and a small committed fixture video; keep external process details outside routes.
3. Implement multipart upload by passing validated bytes to `LocalMediaStore`, then persist only its media pointer and coordinate the fixture reasoner pipeline through `AuditRepository`.
4. Test stage transitions and failure persistence, then expose schema-valid persisted audit JSON.
5. Run the Phase 2 gate and `npm.cmd run check`, append results here, then commit/push before Phase 3.

## Operational notes and gotchas

- Node is pinned to `22.16.0` in `.nvmrc`; use a matching Node 22 runtime.
- `npm.cmd install` may need elevated sandbox permission in this environment because npm accesses its registry/cache. Dependencies are currently installed and the lockfile is committed.
- PGlite runs in-process. Fresh database tests currently take roughly one second each while Postgres initializes; this is expected, so retain integration coverage but avoid needlessly opening databases per assertion.
- Migrations must run before seed or repository calls. `migrateDatabase()` records migration IDs in `schema_migrations` and can be safely called more than once.
- `LocalMediaStore` accepts MIME types, not file-name extensions, as its upload authority. Do not trust an uploaded filename when deciding a stored extension.
- Git may warn that the global ignore file under `C:\Users\dhair\.config\git\ignore` is inaccessible. It does not affect this repository.
- Git metadata writes and pushing require elevated sandbox permission. `main` tracks `origin/main`; the historical remote `master` branch is intentionally untouched.
- Do not place actual API keys in `.env.example` or commit a `.env` file.

## Resume checklist

1. Check `git status --short --branch`.
2. Read the current phase and its test gate in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).
3. Write the next failing Phase 2 tests first, implement only enough to make them pass, then run `npm.cmd run check`.
4. Update this document and the plan checkboxes only after the phase passes, then commit and push to `main`.
