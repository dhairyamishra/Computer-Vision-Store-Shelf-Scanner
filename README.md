# Computer-Vision-Store-Shelf-Scanner

A mobile vision AI pipeline that reads retail shelves and outputs structured JSON audits.

## Project status

Phases 0–3 are complete: shared contracts, local persistence/media storage, a deterministic video-to-audit API vertical slice, and quality-aware local perception. The approved architecture, phased work breakdown, test gates, risks, and progress tracker live in the [implementation plan](docs/IMPLEMENTATION_PLAN.md).

## Development baseline

Phase 0 uses Node.js 22.16.0, pinned in [.nvmrc](.nvmrc). On Windows PowerShell systems that block `npm.ps1`, run commands through `npm.cmd`, for example `npm.cmd test`.

## Run the local API

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:3000` to use the basic upload UI. It accepts JPEG, PNG, WebP, MP4, MOV, and WebM media, and sends it through the same persisted audit pipeline as the API. `GET /health` returns `{ "status": "ok" }`. Runtime data is local and ignored under `data/`. FFmpeg and ffprobe are bundled for this prototype; set `FFMPEG_PATH` and `FFPROBE_PATH` to override either executable.

The local detector is optional supporting evidence: it uses quantized `Xenova/detr-resnet-50` through Transformers.js, caches its first-run download in ignored `data/model-cache`, and never assigns a catalog SKU. Run its opt-in smoke test with `npm.cmd run test:detector:smoke`.
