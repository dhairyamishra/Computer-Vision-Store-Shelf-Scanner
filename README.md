# Shelf Audit Prototype

Upload a shelf photo or short video, choose the store being visited, and receive a persisted JSON shelf audit. The app is intentionally small: the goal is to demonstrate a real media-to-structured-record pipeline, not a polished dashboard.

## Run it locally

You need Node.js 22.16+ and an xAI API key for real vision analysis.

### Windows

```powershell
npm.cmd install --include=dev
Copy-Item .env.example .env
npm.cmd run dev
```

Set `XAI_API_KEY` in `.env`, then open [http://localhost:3000](http://localhost:3000).

Optional free local OCR:

```powershell
winget install --id UB-Mannheim.TesseractOCR --exact
```

Restart PowerShell after installing it. If needed, set `TESSERACT_PATH` in `.env` to the full path of `tesseract.exe`. OCR is optional; the app still works without it.

### macOS / Linux

```bash
npm install --include=dev
cp .env.example .env
npm run dev
```

Set `XAI_API_KEY` in `.env`, then open [http://localhost:3000](http://localhost:3000). To use optional OCR, install your platform's `tesseract` package or set `TESSERACT_PATH`.

Run checks with `npm.cmd run typecheck` and `npm.cmd test` on Windows, or `npm run typecheck` and `npm test` on macOS/Linux.

## What happens to an upload

```text
Photo or video upload
  → choose the store account
  → extract and score video frames locally
  → retain the best frame from each second
  → choose up to 12 frames covering the full video
  → optional local Tesseract text read
  → Grok reviews the selected images
  → backend validates and grounds the JSON audit
  → save the audit, source-media pointer, and evidence metadata locally
```

For a photo, the app uses one evidence frame. For video, FFmpeg samples two frames per second. Sharp scores focus, exposure, clipping, and visual change. The backend keeps the best available frame per second, then sends at most 12 frames to Grok. This keeps the request bounded while still covering the beginning and end of the video.

## Why these choices

- **Browser upload UI:** It was the fastest way to prove the real video-to-audit loop in the time available. The API is separate, so an Expo/React Native camera client can use the same workflow later.
- **Grok for visual interpretation:** Retail footage needs general visual reasoning across products, signs, and categories. No model was trained for this prototype.
- **Local frame selection and grounding:** These are owned by the application, not delegated to the model. The backend decides which frames are useful, validates the response shape, records evidence timestamps, scopes catalog matching to the detected category, and allows fields to be unknown.
- **Optional Tesseract OCR:** It is free and local. It provides supporting text from selected frames, such as visible product names or promotion wording. It is deliberately not trusted as a standalone SKU or price reader.

## What the audit can say honestly

The audit includes the selected account, visible category, observed products, evidence references, confidence, capture quality, coverage of the video, notes, and catalog scope.

The app only returns an exact SKU when the visible evidence and the relevant account catalog support it. When text, size, variant, facings, or shelf position cannot be read, the field is marked as not observable instead of guessed. An expected product is not called out of stock merely because it was not seen.

Bad lighting, glare, motion blur, hidden labels, and near-identical packaging are the first things to fail. The response should become lower-confidence or incomplete rather than confidently wrong. The local OCR experiment reinforces this: it finds useful text in real footage, but its noisy output is only supporting evidence.

## Data and samples

Audits, uploads, extracted frames, and the local PGlite database are stored under `data/` and ignored by Git. Set `SHELF_AUDIT_DATA_DIRECTORY` in `.env` to use another local runtime folder.

Five real handheld store videos are included in [`data/sample-store-videos`](data/sample-store-videos). They contain varied angles, partial labels, movement, and multiple retail categories.

## Deliberate limits

This demo uses PGlite and local files rather than Supabase/Postgres and cloud storage. That kept the focus on the extraction and grounding workflow. In production, Supabase would hold `accounts`, `products`, `account_assortments`, `audits`, and `audit_evidence`; private object storage would hold videos and frames.

The prototype does not yet include an Expo client, offline upload queue, dedicated price-tag OCR, planogram comparison, share-of-shelf calculation, or a broad product catalog. A production mobile app would save an encrypted draft locally, use an idempotency key, and retry uploads when a connection returns.

The main cost and delay is the managed vision request, followed by upload time. To cut latency, reduce the selected-frame count or image resolution. At scale, measure SKU and out-of-stock precision/recall, field-level accuracy, confidence calibration, abstention rate, and rep corrections. A confidence score earns trust only when high-confidence results prove more accurate than low-confidence results.
