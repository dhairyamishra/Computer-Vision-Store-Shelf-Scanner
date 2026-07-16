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
