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

### Enable optional free OCR

OCR is optional. The app still runs without it, but Tesseract can add supporting text from selected frames. It is not used as a standalone price or SKU reader.

On Windows, install Tesseract:

```powershell
winget install --id UB-Mannheim.TesseractOCR --exact
```

Open a new PowerShell window and verify the installation:

```powershell
& "C:\Program Files\Tesseract-OCR\tesseract.exe" --version
```

If that command works, add this line to `.env` before starting or restarting the app:

```text
TESSERACT_PATH=C:\Program Files\Tesseract-OCR\tesseract.exe
```

On macOS, run `brew install tesseract`. On Ubuntu/Debian Linux, run `sudo apt-get install tesseract-ocr`. Leave `TESSERACT_PATH` blank when `tesseract --version` works from your terminal; otherwise set it to the executable's full path.

After submitting media, OCR is confirmed when the returned audit JSON includes:

```json
"provenance": { "ocrVersion": "tesseract v..." }
```

### macOS / Linux

```bash
npm install --include=dev
cp .env.example .env
npm run dev
```

Set `XAI_API_KEY` in `.env`, then open [http://localhost:3000](http://localhost:3000). Follow the OCR instructions above if you want local text evidence.

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

## Reflection

### Summary: the approach and the tradeoff

I focused the time box on the hard part: turning a real, messy shelf video into an honest, persisted record. The browser upload screen is deliberately thin; it was faster than building the Expo client while still proving the actual video pipeline. The API, schema, and media workflow are independent of that screen, so an Expo/React Native client can use the same backend later.

I did not train a retail model. Instead, the application selects useful evidence locally, uses Grok for visual interpretation, optionally adds free local Tesseract text evidence, and then applies its own schema validation and grounding rules. The model proposes a read; the application decides whether it is structured, in scope, and sufficiently supported to become an audit.

### Latency and cost

Capture and upload cost time on the device and network. On the server, FFmpeg frame extraction, Sharp quality scoring, and optional local Tesseract OCR are comparatively cheap. The main latency and variable cost is the Grok request because it performs multi-image reasoning. To control that cost, the backend samples two frames per second, retains the best frame from each second, and sends at most 12 frames while preserving full-video coverage.

To roughly halve latency, I would first lower the selected-frame budget or resize evidence images before changing the grounding contract. For an on-device version, capture quality checks, frame selection, OCR triage, local persistence, and upload retry would move into the mobile app. Final product interpretation would still use a server-side catalog and policy layer.

### Bad video and preventing a wrong read

Glare, oblique angles, motion blur, hidden labels, tiny text, and near-identical packages fail first. The audit responds with capture-quality warnings, evidence timestamps, confidence, and `not_observable` fields rather than filling gaps with guesses. Exact SKU matching requires both readable visual evidence and a matching account catalog; an expected product that was not seen is not automatically called out of stock.

OCR is deliberately supporting evidence, not truth. Tesseract can recover useful visible words, but its noisy fragments are not allowed to create a price, SKU, size, or promotion claim unless the corresponding frame also supports the claim. This keeps a confident-looking OCR mistake from becoming a rep-facing fact.

### No signal or failed upload

This synchronous demo does not yet implement offline capture or resumable upload. In production, the mobile client would encrypt and save the source video plus an audit draft locally, attach an idempotency key, display a durable pending state, and retry when connectivity returns. The server would treat repeated uploads with that key as the same audit rather than creating duplicates.

### Knowing SKU and out-of-stock reads are right at scale

I would measure SKU precision and recall by match level, field-level accuracy for brand/product/variant/size, out-of-stock precision and recall, confidence calibration, abstention rate, and rep corrections. A confidence score earns trust only if high-confidence claims are measurably more accurate than medium- or low-confidence claims. Evidence links and the ability to abstain are as important as the score itself.

### What I deliberately did not build

I used PGlite and local files rather than Supabase/Postgres and cloud storage so the time box stayed focused on extraction and grounding. A production version would use Supabase tables for `accounts`, `products`, `account_assortments`, `audits`, and `audit_evidence`, with private object storage for videos and frames.

I also did not build the Expo client, offline queue, dedicated price-tag OCR, planogram comparison, share-of-shelf calculation, competitor/promotion extraction, or a broad production catalog. Those are important product capabilities, but adding them before the real video-to-defensible-record loop worked would have made the prototype wider rather than more trustworthy.

## Data and samples

Audits, uploads, extracted frames, and the local PGlite database are stored under `data/` and ignored by Git. Set `SHELF_AUDIT_DATA_DIRECTORY` in `.env` to use another local runtime folder.

Five real handheld store videos are included in [`data/sample-store-videos`](data/sample-store-videos). They contain varied angles, partial labels, movement, and multiple retail categories.
