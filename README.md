# Computer-Vision-Store-Shelf-Scanner

A mobile vision AI pipeline that reads retail shelves and outputs structured JSON audits.

## Project status

Phases 0–2 are complete: shared contracts, local persistence/media storage, and a deterministic video-to-audit API vertical slice. The approved architecture, phased work breakdown, test gates, risks, and progress tracker live in the [implementation plan](docs/IMPLEMENTATION_PLAN.md).

## Development baseline

Phase 0 uses Node.js 22.16.0, pinned in [.nvmrc](.nvmrc). On Windows PowerShell systems that block `npm.ps1`, run commands through `npm.cmd`, for example `npm.cmd test`.

## Run the local API

```powershell
npm.cmd install
npm.cmd --workspace @shelf-audit/api run dev
```

The API listens on `http://127.0.0.1:3000`; `GET /health` returns `{ "status": "ok" }`. Runtime data is local and ignored under `data/`. FFmpeg and ffprobe are bundled for this prototype; set `FFMPEG_PATH` and `FFPROBE_PATH` to override either executable.
