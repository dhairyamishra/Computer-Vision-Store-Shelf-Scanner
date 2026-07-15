# Development Handoff

## Current state

Phases 0–3 are complete on `main`; Phase 4 (Grok extraction and provider abstraction) is next. The implementation plan is the authoritative progress tracker: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

✅ Committed and verified: `e0bad10` (`chore: establish typed workspace foundation`), `68839bb` (`docs: record phase 0 handoff`), `705a3a7` (`feat: add local audit persistence`), `72837f1` (`feat: add fixture video audit pipeline`), and the current Phase 3 quality-aware local-perception commit.

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

## Phase 2 delivered

| Area                  | Location                                                                    | Result                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local server          | `apps/api/src/server/index.ts`, `apps/api/src/main.ts`                      | Fastify health, account list, audit status, and multipart audit creation routes; runs through the API workspace `dev`/`start` scripts.                   |
| Video boundary        | `apps/api/src/video/`                                                       | FFprobe metadata inspection, FFmpeg extraction, timestamped frame filenames, 8-frame temporal cap, configurable executable paths, and rotation warnings. |
| Fixture reasoning     | `apps/api/src/reasoning/fixture-shelf-reasoner.ts`                          | A deterministic, schema-validated final audit so the vertical slice needs no API key or paid inference.                                                  |
| Persistence extension | `apps/api/src/persistence/audit-repository.ts`                              | Persists stage timing and canonical completed `ShelfAudit` JSON; failures keep a stable error code/message and the source pointer.                       |
| Fixture and API tests | `apps/api/test/fixtures/three-colors.mp4`, `apps/api/test/pipeline.test.ts` | A committed three-second video and Fastify injection tests covering the full fixture path plus failure handling.                                         |

The route deliberately persists the source video before processing. It then transitions the audit through every pipeline stage and records `totalMs`. If inspection, extraction, or reasoning fails, it records timing and transitions to `failed`; a secondary persistence failure never replaces the original processing error. The fixture reasoner produces no product or OOS claims, which is intentional: it validates the data flow without fabricating business insight before visual reasoning is implemented.

## Phase 3 delivered

| Area                    | Location                                                                         | Result                                                                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quality-aware selection | `apps/api/src/video/frame-selector.ts`                                           | Sharp calculates sharpness, brightness, clipping, entropy, and a deterministic score; near-duplicates are reduced only when temporally adjacent, while selection retains the best frame from each temporal segment. |
| Local detection         | `apps/api/src/perception/local-detector.ts`                                      | A `LocalDetector` boundary wraps quantized `Xenova/detr-resnet-50` through Transformers.js. It emits generic labels and normalized boxes only—never SKU matches.                                                    |
| Crops and persistence   | `apps/api/src/perception/crops.ts`, `apps/api/src/persistence/`                  | Up to four detector-guided crops supplement, but never replace, overview frames. A migration adds persisted frame-selection and detector metadata to each audit run.                                                |
| Resilience and tests    | `apps/api/test/perception.test.ts`, `apps/api/test/local-detector.smoke.test.ts` | Synthetic quality/duplicate/box/failure tests cover deterministic behavior. The default suite disables model loading in test mode; the explicit smoke command runs the actual local model.                          |

Detector initialization or inference failure is deliberately non-fatal. The completed fixture audit records a capture-quality warning, detector version, and `processingMetadata.detector.available: false`, then proceeds to the existing reasoner. Production-mode detector downloads are cached in ignored `data/model-cache`.

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

For Phase 2, `apps/api/test/pipeline.test.ts` was added before the Fastify and video modules. Its first run failed with `Cannot find module '../src/server/index.js'`. After implementation:

```powershell
npm.cmd run check
# 3 test files passed; 13 tests passed
# Prettier, ESLint, and all three workspace type checks passed

npm.cmd --workspace @shelf-audit/api run start
# Verified GET http://127.0.0.1:3000/health returns {"status":"ok"}
```

For Phase 3, `apps/api/test/perception.test.ts` was added before the scoring and perception modules. Its first run failed because `sharp` was not installed. After implementation:

```powershell
npm.cmd run check
# 4 test files passed; 17 tests passed; 1 opt-in smoke test skipped

npm.cmd run test:detector:smoke
# 1 test passed against the extracted fixture frame
```

Run `npm.cmd run check` after every phase. Use `npm.cmd`, not `npm`, in this PowerShell environment because execution policy blocks `npm.ps1`.

## Next phase: Grok extraction and provider abstraction

Follow Phase 4 in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). Start test-first:

1. Add failing tests for prompt construction, response validation, and stable provider failure mapping before adding provider dependencies.
2. Keep `ShelfReasoner` provider-neutral and send only selected overview frames, limited crops, detector manifest, catalog, and expected assortment.
3. Make Grok the explicit default, validate every raw response with the shared Zod schema, and persist provider/model/prompt metadata.
4. Do not let provider errors leave an audit in an intermediate state; preserve source media and stable error codes.
5. Run the Phase 4 gate and `npm.cmd run check`, append results here, then commit/push before Phase 5.

## Operational notes and gotchas

- Node is pinned to `22.16.0` in `.nvmrc`; use a matching Node 22 runtime.
- `npm.cmd install` may need elevated sandbox permission in this environment because npm accesses its registry/cache. Dependencies are currently installed and the lockfile is committed.
- PGlite runs in-process. Fresh database tests currently take roughly one second each while Postgres initializes; this is expected, so retain integration coverage but avoid needlessly opening databases per assertion.
- Migrations must run before seed or repository calls. `migrateDatabase()` records migration IDs in `schema_migrations` and can be safely called more than once.
- `LocalMediaStore` accepts MIME types, not file-name extensions, as its upload authority. Do not trust an uploaded filename when deciding a stored extension.
- `ffmpeg-static` and `ffprobe-static` are bundled dependencies, so Phase 2 tests do not need system binaries. Set `FFMPEG_PATH`/`FFPROBE_PATH` to override them. Rotation metadata is surfaced as a warning and FFmpeg's default autorotation is retained.
- The first local API smoke start exposed that npm workspace scripts use `apps/api` as the working directory. `DEFAULT_DATA_DIRECTORY` is now anchored to the repository root from `apps/api/src/persistence/database.ts`; it creates `data/pgdata` before PGlite opens.
- `npm.cmd run test:detector:smoke` must run from the repository root. It invokes the real quantized DETR model and is intentionally omitted from the default suite; its cache is ignored under `data/model-cache`.
- The local API start command leaves a listener running until it is stopped. During the smoke check, `GET /health` returned `{"status":"ok"}` and the listener was then stopped.
- Git may warn that the global ignore file under `C:\Users\dhair\.config\git\ignore` is inaccessible. It does not affect this repository.
- Git metadata writes and pushing require elevated sandbox permission. `main` tracks `origin/main`; the historical remote `master` branch is intentionally untouched.
- Do not place actual API keys in `.env.example` or commit a `.env` file.

## Resume checklist

1. Check `git status --short --branch`.
2. Read the current phase and its test gate in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).
3. Write the next failing Phase 4 tests first, implement only enough to make them pass, then run `npm.cmd run check`.
4. Update this document and the plan checkboxes only after the phase passes, then commit and push to `main`.
