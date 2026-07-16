# Computer-Vision-Store-Shelf-Scanner

A browser-based shelf-audit prototype: upload a shelf photo or short video, have Grok analyze selected evidence frames against an account catalog, and review the persisted structured JSON audit.

## Run locally

Requirements:

- Node.js 22.16.0 (see [.nvmrc](.nvmrc))
- An xAI API key for real Grok inference

### Windows PowerShell

Use `npm.cmd` rather than `npm`:

1. Install dependencies:

   ```powershell
   npm.cmd install --include=dev
   ```

2. Create a local environment file and set the Grok key:

   ```powershell
   Copy-Item .env.example .env
   ```

   In `.env`, set `XAI_API_KEY` and leave `FFMPEG_PATH` / `FFPROBE_PATH` blank to use the bundled binaries. Do not commit `.env`.

3. Start the combined backend and browser UI:

   ```powershell
   npm.cmd run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000). Select an account, upload a JPEG/PNG/WebP image or MP4/MOV/WebM video, and submit it for analysis. The completed audit JSON is displayed in the browser.

The health check is available at [http://localhost:3000/health](http://localhost:3000/health) and returns `{ "status": "ok" }`.

### macOS / Linux

```bash
npm install --include=dev
cp .env.example .env
```

Set `XAI_API_KEY` in `.env`, then run:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Local runtime data

Audits, uploads, frames, the local PGlite database, and the optional detector cache are stored locally under `data/` and are ignored by Git. To use a separate runtime directory, set `SHELF_AUDIT_DATA_DIRECTORY` in `.env`, for example:

```text
SHELF_AUDIT_DATA_DIRECTORY=C:\tmp\shelf-audit-runtime
```

If a previous local database is incompatible after a branch change, set this variable to a new empty directory instead of deleting existing data.

## Verification

```powershell
npm.cmd run typecheck
npm.cmd test
```

The optional local generic detector is not required for the browser demo. Its smoke test can be run with:

```powershell
npm.cmd run test:detector:smoke
```

## Sample videos

Five real, messy shelf videos are included in [`data/sample-store-videos`](data/sample-store-videos). They are short handheld store-aisle captures and can be uploaded directly through the browser UI. They intentionally include movement, partial labels, varied angles, and a candy aisle so the category detection is not restricted to beverages.

## Architecture and reflection

### What was built

This is a deliberately small browser harness around the core field-audit loop: select an account, upload a photo or video, extract representative frames, ask Grok for a structured visual reading, apply grounding rules, and persist the audit locally. I used a browser UI rather than completing the Expo client because it made the real video-to-JSON loop demonstrable within the time box; an Expo/React Native client would call the same API in production.

FFmpeg extracts video frames and the application selects a quality-aware, coverage-preserving subset. Grok performs the visual reading. The application—not the model—owns schema validation, evidence references, category-to-catalog applicability, exact-SKU downgrades, capture-quality status, and the rule that an absent expected product is not automatically out of stock.

### Latency and cost

The largest latency and cost is the managed vision request, followed by upload for a larger video. Local frame extraction and scoring are inexpensive. For short videos, one retained frame per second is analyzed; longer videos are capped at 12 coverage/scene-change frames to bound payload and model cost. To halve latency, I would reduce the frame budget or image resolution before changing the reasoning contract. For on-device operation, I would move capture, quality scoring, and upload retry to the client, then use a smaller local model/OCR only for triage; exact product interpretation would still need a server-side catalog and policy layer.

### Bad footage and trust

Glare, motion blur, oblique angles, hidden labels, and nearly identical packages fail first. The audit responds with capture-quality warnings, nullable fields, evidence references, and lower confidence instead of filling unsupported details. A wrong read is caught by requiring selected-frame evidence for material claims, restricting exact SKU matches to catalog-supported visual details, and treating unreadable size/variant/price as not observable. Confidence is only useful if it is calibrated against field-level accuracy and abstention is allowed.

### Offline and scale

This demo processes synchronously and does not yet provide offline capture or resumable upload. A production mobile client would save the encrypted video and audit draft locally, assign an idempotency key, queue upload when connectivity returns, and show a durable pending state. At scale, I would measure SKU precision/recall by match level, field-level accuracy, OOS precision/recall, confidence calibration, abstention rate, and rep overrides. Trust comes from showing evidence and from a high-confidence claim being measurably more reliable than a medium-confidence one—not from maximizing the number of claims.

### Deliberate omissions and production persistence

I did not build a complete Expo client, dedicated OCR, planogram engine, background queue, offline sync, or broad retail catalog. I also intentionally used local PGlite and filesystem media rather than Supabase because this is a small runnable demo and the real extraction/grounding loop was the higher-value use of the time box.

For a real product, I would use Supabase Postgres and Storage: `accounts`, `products`, and `account_assortments` would hold catalog/expected-shelf data; `audits` would store audit status, account, source-media pointer, final JSON, and model metadata; `audit_evidence` would store selected-frame pointers and scores. Private Storage would hold source videos and frames, with row-level security scoped to the account/organization. That replaces the local PGlite/media layer without changing the audit contract.
