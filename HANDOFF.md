# Shelf Audit â€” Development Handoff

**Status:** The desktop browser application, local API, Grok reasoning, category-aware catalog scoping, and full-duration video evidence pipeline are implemented. The spinner and capture-quality calibration changes are verified locally but uncommitted when this handoff was written.

**Goal:** Upload shelf image/video at `http://localhost:3000`, identify the visible category and grounded product observations, and use SKU/OOS checks only when the selected account has a matching supplied catalog category.

## Current state

- `5333b6d` â€” full-duration video reliability: 2-FPS extraction, one retained frame per second, capped scene-change/coverage inference, coverage metadata, category-neutral runtime, and provider-output hardening.
- `f6d6b07` â€” category-aware catalog scoping; unrelated assortments do not produce OOS claims.
- `bf1e0cf` â€” local run instructions in `README.md`.
- ðŸ”¶ Uncommitted:
  - `apps/api/src/server/ui.ts`: animated processing spinner for active uploads/audits.
  - `apps/api/src/video/frame-selector.ts`: calibrated blur threshold (`0.002`, formerly `0.08`).
  - `apps/api/src/reasoning/grok-shelf-reasoner.ts`: locally usable evidence becomes `degraded` when Grok reports visual limits.
  - `apps/api/test/reasoning.test.ts`: status-downgrade regression test.

Verified after the uncommitted work:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run lint
# 27 tests passed; 1 intentional local-detector smoke test skipped
```

## How it works

1. `apps/api/src/server/ui.ts` serves the desktop UI at `GET /`. It loads accounts, submits multipart media to `POST /audits`, and displays the persisted JSON.
2. `apps/api/src/server/index.ts` persists media, enforces the two-minute limit, extracts evidence, records selection diagnostics, runs the reasoner, and persists the final audit.
3. `apps/api/src/video/ffmpeg-video-processor.ts` extracts at **2 FPS for the entire upload**. The old first-12-frames cap is gone.
4. `apps/api/src/video/frame-selector.ts` scores Sharpness/exposure/clipping/entropy/perceptual difference. It retains the best candidate per second, then sends all retained frames through 12 seconds or a first/last-inclusive scene-change and temporal subset of at most 12 frames.
5. `packages/contracts/src/schemas.ts` defines final `evidenceCoverage`: duration, retained/analyzed counts, timestamps, and strategy.
6. `apps/api/src/reasoning/grok-shelf-reasoner.ts` detects category and observations. Catalog data applies only when account and observed categories match; otherwise OOS is empty and observations are generic.

## Real-video validation

Sample video:

`C:\\--DPM-MAIN-DIR--\\--GIT-REPOS--\\Computer-Vision-Store-Shelf-Scanner\\data\\sample-store-videos\\WhatsApp Video 2026-07-15 at 7.31.40 PM.mp4`

It is a nine-second chocolate/candy aisle. Before `5333b6d`, cited evidence stopped at 0â€“7 seconds. After it, the real audit returned:

```json
"catalogScope": { "observedCategory": "candy", "catalogCategory": null, "status": "no_matching_catalog" },
"evidenceCoverage": {
  "sourceDurationMs": 9000,
  "retainedFrameCount": 9,
  "analyzedFrameCount": 9,
  "firstAnalyzedTimestampMs": 0,
  "lastAnalyzedTimestampMs": 8500
}
```

This confirms complete coverage and correct generic category behavior. It exposed the blur-calibration defect: best-frame sharpness was `0.0025â€“0.0087` while the old blurry cutoff was `0.08`, making the audit incorrectly `unusable` despite legible labels. The uncommitted calibration corrects this. Grok's real warnings about occlusion/fine print should make the next final audit `degraded`, not `unusable`.

## Important decisions

- Category is media-first; never hard-code a category or infer it from demo catalog data.
- Catalog is optional context, not vision truth. No matching category means generic evidence onlyâ€”no SKU, compliance, or OOS claims.
- The beverage-specific DETR/crop runtime stage was removed. It filtered `bottle`, `cup`, and `wine glass`, did not feed Grok, and leaked technical errors. Unused detector modules/smoke test remain but are off the audit path.
- Grok claims must be visually grounded. Prompting prohibits outside knowledge, and `removeKnowledgeBasedClaims()` downgrades explanations such as â€œknown forâ€ and â€œtypically.â€
- Only visual provider warnings enter capture quality; catalog/account/provider/detector/model/system messages are filtered.

## Recommended next step

1. Commit and push the current spinner/quality/handoff work.
2. Restart the API and upload the same candy video once.
3. Verify spinner visibility, 9/9 coverage through 8500 ms, and `captureQuality.status: "degraded"`.
4. If it remains `unusable`, inspect persisted `processingMetadata.retainedFrames` scores before changing the threshold again.

## Gotchas

- Use `npm.cmd`, not `npm`, in PowerShell.
- For a healthy isolated PGlite runtime:

```powershell
$env:SHELF_AUDIT_DATA_DIRECTORY='C:\\tmp\\shelf-audit-restored'
npm.cmd run dev
```

Open `http://localhost:3000`; health is at `/health`.
- Blank `FFMPEG_PATH`/ `FFPROBE_PATH` values used to create an empty executable-path failure; keep them unset or valid.
- `main` was recovered on 2026-07-15 after a rebase/reset hid the browser UI. Preserve `recovered-desktop-ui` and `pre-recovery-minimal-implementation`; do not history-rewrite `main` without an explicit backup branch and approval.
- Git global-ignore permission warnings are non-blocking. Git metadata writes and pushes need elevated sandbox permission here.
- Never print or commit `.env` or API keys.

## File map

| Path | Purpose |
| --- | --- |
| `apps/api/src/server/ui.ts` | Embedded desktop UI and processing spinner. |
| `apps/api/src/server/index.ts` | Fastify routes and audit orchestration. |
| `apps/api/src/video/frame-selector.ts` | Per-second quality retention and inference selection. |
| `apps/api/src/reasoning/grok-shelf-reasoner.ts` | Grok request, grounding, warning/status normalization. |
| `packages/contracts/src/schemas.ts` | Final schemas including category/coverage metadata. |
| `apps/api/test/perception.test.ts` | Quality, 9-second coverage, long-video cap tests. |
| `apps/api/test/reasoning.test.ts` | Catalog, warnings, mojibake, grounding, quality-status tests. |
| `README.md` | Installation and run instructions. |

## Git safety

Before history-changing Git operations:

```powershell
git status --short --branch
git log --oneline -12
```

Do not use `git reset`, `rebase --abort`, or force-push on `main` without a named backup branch and recorded before/after commits.
