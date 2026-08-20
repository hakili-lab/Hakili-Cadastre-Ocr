# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Hakili OCR turns photos/scans/PDFs of handwritten math homework into structured, editable LaTeX/Markdown. A student or teacher uploads an image or PDF; the backend sends it to Claude (Anthropic's vision model) with a prompt tuned for handwritten math, gets back a list of transcribed "blocks" (each with Markdown/LaTeX text, a bounding box on the source image, and a confidence score), and the frontend renders the source image side-by-side with the transcription, letting the user click a block to highlight its region, edit its text inline, and drag its bounding box if it's misplaced.

## Repository layout

This repo contains two independent, separately-run projects with no shared tooling or monorepo config:

- `ocr-math-api/` — Python/FastAPI backend that calls the Claude (Anthropic) API to OCR handwritten math homework into structured LaTeX/Markdown.
- `hakili-ocr/` — React 19 + TypeScript + Vite frontend that uploads images/PDFs to the backend and renders the results with an editable, block-by-block viewer.

They communicate only over HTTP: the frontend calls the backend at `http://127.0.0.1:8000` (hardcoded in `hakili-ocr/src/hooks/useTranscribe.ts`), and the backend's CORS middleware in `ocr-math-api/app/main.py` allows `http://localhost:5173` and `http://localhost:5174` (Vite's dev port, which increments if 5173 is already taken — e.g. by another dev server instance). Both must be run simultaneously for the app to work end to end.

## Commands

### Backend (`ocr-math-api/`)

```bash
python -m venv .venv
.venv\Scripts\activate            # Windows
pip install -r requirements.txt
cp .env.example .env             # then set ANTHROPIC_API_KEY

uvicorn app.main:app --reload    # run dev server on http://127.0.0.1:8000
```

- Interactive API docs (Swagger): `http://127.0.0.1:8000/docs`
- There is no automated test suite (pytest, etc.) — `tests/test_transcribe.py` is a manual script that POSTs `images/Test_01.png` to a running local server:
  ```bash
  python tests/test_transcribe.py
  ```
- No linter/formatter is configured for the backend.
- PDF support depends on `pymupdf` (imported as `fitz`) — make sure it's installed in whichever Python environment actually runs `uvicorn` (there may be more than one Python install on the machine; verify with `python -c "import fitz"` in the *same* environment used to launch the server).

### Frontend (`hakili-ocr/`)

```bash
npm install
npm run dev        # Vite dev server on http://localhost:5173
npm run build       # tsc -b && vite build
npm run lint         # oxlint
npm run preview
```

- No test runner is configured. `test_table.mjs` at the project root is a standalone manual script (run with `node test_table.mjs`, not wired into `package.json`) for eyeballing how `remark-gfm`/`remark-rehype` turn a Markdown table into HTML — useful when debugging the table-rendering pipeline in `ResultScreen.tsx`.

## Backend architecture (`ocr-math-api/`)

### Image transcription (`POST /transcribe`)

Defined in `app/routers/transcription.py`:

1. **Validate** content type and file size (`app/utils/image_utils.py`: `validate_content_type`, `validate_size`).
2. **Normalize** EXIF orientation (`normalize_orientation`) and **resize** the image to fit Claude's vision limits — max edge 1568px, max ~1568 vision tokens computed via a 28px tiling formula (`resize_for_vision` / `resized_size`).
3. **Call Claude** (`app/services/claude_service.py`, `call_anthropic_ocr`, `async`): sends the base64 image plus a French system prompt (`SYSTEM_PROMPT`) instructing the model to:
   - ignore crossed-out/scribbled content and transcribe only the final clean math,
   - wrap any content it isn't confident it read correctly — even a single digit, letter, or symbol, including *inside* a `$...$`/`$$...$$` formula — in `==...==` highlight markers (this is unrelated to the strike-out rule: highlighting means "uncertain," not "crossed out"),
   - for tables, emit **one block per data row** rather than one block for the whole table: each row-block repeats the header + separator line followed by just that row's data, with its own `id`/`label`/`bbox`/`confidence`,
   - return bounding boxes in **absolute pixel coordinates** (the exact resized image dimensions are given to the model in the user message — the model must not estimate fractions itself).
4. If `message.stop_reason == "max_tokens"`, the response is treated as a truncation error (raises `ValueError`) rather than being force-parsed as JSON — a longer/more verbose response (e.g. pages with tables) can exceed `MAX_TOKENS` and get cut off mid-JSON.
5. **Parse and normalize the response** (`parse_claude_response`): strips optional ```` ```json ```` fences, parses JSON, converts each block's pixel bbox into a 0–1 normalized fraction using the same width/height that was sent to Claude, injects a "Confiance" column into every table-row block's markdown (`inject_confidence_column`, keyed off that block's own `confidence` field — the single source of truth, so Claude is never trusted to retranscribe the percentage itself, keeping it consistent with the bbox color shown on the frontend), and validates the result against the `OCRResult` Pydantic schema (`app/models/schemas.py`).
6. Bounding boxes are clamped to `[0, 1]` and `x_max`/`y_max` are validated to be ≥ their `_min` counterpart via Pydantic field validators on `BoundingBox`.

Key architectural point: bbox normalization always divides by the dimensions of the *resized* image actually sent to Claude, not the original upload — this consistency is what keeps frontend-rendered boxes aligned with the displayed (resized) image.

The Anthropic client is `anthropic.AsyncAnthropic`, built once via a module-level `@lru_cache`d `_get_client()` in `claude_service.py` and reused across calls (HTTP keep-alive, no per-call reconnect). `call_anthropic_ocr` is `async` and does `await client.messages.create(...)` — this matters because the route handlers are `async def`; a blocking/sync Anthropic call there would stall the whole event loop, not just the current request.

### PDF transcription (`POST /transcribe/pdf/start` + `GET /transcribe/pdf/status/{job_id}`)

PDFs are **not** processed synchronously within one HTTP request — a long PDF (dozens/hundreds of pages) would otherwise mean one very long blocking POST. Instead:

1. `POST /transcribe/pdf/start` validates the upload, rasterizes every page to PNG via PyMuPDF (`convert_pdf_to_images`, 150 DPI), creates a job (`app/services/job_store.py`, in-memory `dict[job_id -> PDFJob]`), and schedules `_run_pdf_job(job_id, page_images)` as a **fire-and-forget** `asyncio.create_task` — the endpoint returns `{ job_id, pages_total }` immediately, before any page is transcribed.
2. `_run_pdf_job` loops over pages **sequentially** (one `_process_single_image` `await` at a time — not yet parallelized, this is a known/expected future optimization), updating `job.pages_done` after each page so progress is observable mid-flight.
3. `GET /transcribe/pdf/status/{job_id}` returns the job's current `status` (`"processing" | "done" | "error"`), `pages_done`/`pages_total`, and — once `"done"` — the full `PDFTranscriptionResult`. The frontend polls this endpoint (every 8s, `PDF_POLL_INTERVAL_MS` in `useTranscribe.ts`) to show real per-page progress instead of a generic loading animation.

**Known limitation**: `job_store.py`'s job dict is process-local memory — jobs are lost on restart and it wouldn't work across multiple workers/processes (would need Redis or similar for that). The app is built as a **multi-user SaaS**, not a personal-use tool — this is an accepted limitation only as long as the deployment stays pinned to a single, vertically-scaled instance (see "Production readiness" below), not a long-term assumption.

Config (`app/config.py`) is loaded once via `@lru_cache` from environment variables (`.env` via `python-dotenv`): `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-sonnet-5`), `MAX_IMAGE_SIZE_MB` (default `5`), `MAX_PDF_SIZE_MB` (default `500`), `MAX_PDF_PAGES` (default `600`), `JOB_TTL_SECONDS` (default `14400`, 4h), `MAX_TOKENS` (default `4096` in code — but `.env.example` sets it to `8192`, which is what a fresh `.env` copy will actually use).

Error handling convention in the router: `ValueError` → 400/422 depending on stage, `RuntimeError` (missing API key) → 500, `anthropic.APIError` → 502, anything else → 500. PDF uploads are validated against `MAX_PDF_SIZE_MB` (a dedicated limit, no longer derived from the image limit) and `MAX_PDF_PAGES` (rejected with 400 before any page is rasterized) — matches the frontend's client-side check in `UploadScreen.tsx` (5 MB for images, 500 MB for PDFs).

### Corrections dataset (`POST /corrections`)

When a user fixes a block's transcribed text in the frontend, the app can optionally capture that correction for future prompt/model improvement: the cropped source-image region for that block, the original (Claude-transcribed) text, the corrected text, and a free-text description of what was wrong.

- Storage is SQLite (stdlib `sqlite3`, no new dependency) plus PNG files on disk, under `ocr-math-api/data/` (gitignored, path anchored on `__file__` so it doesn't depend on the cwd `uvicorn` is launched from) — consistent with the same single-process assumption as `job_store.py`, accepted for now only as long as the deployment stays pinned to one instance (see "Production readiness" below), not a long-term assumption given the app is a multi-user SaaS.
- `app/services/correction_store.py` owns the schema (`corrections` table: id, image_path, block_label, confidence, original_markdown, corrected_markdown, error_description, created_at) and `save_correction(...)`, which writes the image then the row in one transaction. `sqlite3.Connection` isn't thread-safe, so each call opens/closes its own connection rather than sharing one — the endpoint invokes it via `asyncio.to_thread`, potentially from a different thread each time.
- `app/routers/corrections.py` exposes `POST /corrections` as multipart (`image` file + form fields), reusing `validate_content_type`/`read_upload_with_limit` from `image_utils.py` (the latter streams the upload in chunks and aborts as soon as it exceeds `MAX_IMAGE_SIZE_MB`, rather than buffering the full body before checking) and rejecting an empty error description.

## Frontend architecture (`hakili-ocr/`)

Single-page app with four screens (`upload` / `preview` / `loading` / `result`) driven by one `useReducer`-based context, no router:

- `src/context/AppContext.tsx` — global state (`AppState`) and all transitions (`AppAction`). `SET_IMAGE` (file picked) moves to `'preview'`, not straight to `'loading'`; `CONFIRM_UPLOAD` (user clicks "Envoyer" in the preview screen) moves to `'loading'` with the possibly-transformed file; `CANCEL_PREVIEW` goes back to `'upload'`. `UPDATE_BLOCK_MARKDOWN` and `UPDATE_BLOCK_BBOX` update a single block's text or bbox in place (for both the plain-image result and, if a PDF is loaded, the current page inside `pdfResult.pages`) without reparsing the whole transcription result.
- `src/components/PreviewScreen.tsx` — shown between upload and loading. Lets the user rotate the document (90° steps) before sending, tracked as `Record<pageIndex, RotationAngle>` local `useState` (so a multi-page PDF can have a different rotation per page, not just one global angle) — not global app state. For PDFs, renders a client-side page-by-page preview via `src/hooks/usePdfPreview.ts` (`pdfjs-dist`), with prev/next navigation between pages. On confirm, `src/utils/fileTransform.ts`'s `applyRotation` applies the rotation(s) to the *actual file* before it's sent — canvas redraw for images (`rotateImageFile`, single angle), PDF `/Rotate` page metadata per page via `pdf-lib` for PDFs (`rotatePdfFile`, the whole rotations map — respected by PyMuPDF server-side, so it doesn't need to re-rasterize the visual preview). If no page was rotated, the original `File` is sent unmodified.
- `src/hooks/useTranscribe.ts` — exports `useTranscription()`, the single entry point used by `App.tsx` to kick off and track a transcription, for either file type:
  - **Image**: one `useMutation` POST to `/transcribe`, result available directly.
  - **PDF**: a `useMutation` POST to `/transcribe/pdf/start` (gets a `job_id`), then a `useQuery` polling `/transcribe/pdf/status/{job_id}` every `PDF_POLL_INTERVAL_MS` (8s), stopping once `status !== "processing"`. Both paths are normalized into one return shape: `{ start, isPending, isError, error, progress, data }`, where `progress` (`{ pagesDone, pagesTotal }`) is only non-null for the PDF/job path.
  - Has a `USE_MOCK` flag (currently `false`) that bypasses the network entirely with hardcoded `MOCK_RESULT`/`MOCK_PDF_RESULT` fixtures, for frontend-only development.
  - Normalizes `final_warning: null` (from the backend) to `undefined` for consistent optional-field handling in TS. Throws typed `TranscribeError` with `statusCode`/`isRetryable` based on backend HTTP status, built on the shared `apiClient.ts`.
- `src/services/apiClient.ts` — shared `API_BASE`/`TranscribeError`/`fetchApi` used by both `useTranscribe.ts` and `correctionsApi.ts`.
- `src/components/LoadingScreen.tsx` — reads `progress` from `useTranscription()`; when present (PDF), shows a real "Page X / Y" counter and a progress bar driven by actual `pagesDone/pagesTotal`; otherwise (single image) falls back to a generic cycling status-text animation, since there's no meaningful sub-progress for one image.
- `src/components/UploadScreen.tsx` — drag-and-drop / file-picker entry point; client-side validates file type (PNG/JPEG/PDF) and size (5 MB images, 20 MB PDFs) before dispatching `SET_IMAGE`, mirroring the backend's own limits.
- `src/components/ResultScreen.tsx` — renders the source image with overlaid, color-coded (by confidence) bounding boxes alongside Markdown+LaTeX block content, supports selecting a block to scroll/highlight, and PDF page navigation (`pdfResult.pages`, `currentPageIndex`). This file holds only **orchestration** — top-level state (`editingBlockId`/`editDraft`/`editingCell`/`cellDraft`/`blockRefs`/`pendingCorrection`), handlers, and the JSX for the two columns (image panel, content panel); table-editing internals, drag-and-drop, and pure helpers are split into their own modules:
  - `src/utils/tableMarkdown.ts` — table markdown parsing: `tableLines`, `parseTableRowCells`, `withReplacedCell`, `getRowCellTexts`, `isTableBlockMarkdown`, `groupBlocksForRender`/`RenderGroup`. `parseTableRowCells` splits a row on `|` but is aware of `$...$`/`$$...$$` spans (and `\|`), so a literal `|` inside math (`$P(A|B)$`, `$|x|$`) doesn't get misparsed into two malformed cells.
  - `src/utils/confidenceColors.ts` — `getConfidenceColor`/`getConfidenceBorder`/`getConfidenceBoxBg`.
  - `src/utils/markdownHighlight.ts` — the `==...==` uncertain-highlighting system, described below.
  - `src/utils/geometry.ts` — pure functions for bbox math: `pixelDeltaToNormalized` (screen-pixel delta → `[0,1]` fraction, scaled to the container that bbox `%`s are relative to) and `translateBBox` (translate a bbox keeping width/height fixed, clamped per-axis so it stops at the image edge rather than being truncated).
  - `src/hooks/useBlockDrag.ts` — drag state machine for repositioning a block's bbox on the image, built on Pointer Events (`pointerdown`/`pointermove`/`pointerup`/`pointercancel` + `setPointerCapture`) rather than HTML5 Drag and Drop, since native DnD is designed for transferring data between drop zones, not pixel-precise repositioning. A distance threshold (`DRAG_THRESHOLD_PX = 4`) distinguishes a click (fires the existing selection `onClick`) from a drag (fires `onDragEnd` with the final bbox). High-frequency drag state stays in refs/local hook state; only one `dispatch(UPDATE_BLOCK_BBOX)` fires, on release.
  - `src/components/result/dragContext.ts` — `DraggingBlockContext` (which block is being dragged, changes rarely) and `DragOffsetContext` (the live pointer delta, changes on every `pointermove`), split so a `pointermove` doesn't re-render every other box on the image.
  - `src/components/result/BlockOverlay.tsx` — renders each block's bounding box on the image. Memoized, keyed on `block.id`, subscribes only to `DraggingBlockContext`; only the actively-dragged box mounts the inner `DraggingBlockBox`, which reads `DragOffsetContext` and computes its live position via `translateBBox`. Uses an inline SVG cursor (black hand, white outline) instead of the native `grab`/`grabbing` cursor, which renders illegibly white on this panel's light boxes.
  - `src/components/result/editingCellContext.ts` — `EditingCellContext`/`CellDraftContext` (React contexts, kept in their own file so `TableRow.tsx` stays 100% component exports, which Fast Refresh requires).
  - `src/components/result/TableRow.tsx` — `TableDataRow`/`TableDataCell`/`CellEditor`, per-row/per-cell table rendering, described below.
  - `src/components/result/CorrectionModal.tsx` — modal shown after a block/cell edit is confirmed, prompting for a required free-text description of what was wrong; submits via `correctionsApi.ts` to `POST /corrections`.
  - `src/utils/cropImage.ts` — `cropImageToBlob(imageSrc, bbox)`: crops the source image to a block's bbox (via `createImageBitmap` + `<canvas>`) to attach to a correction submission. Works for both a plain image's `blob:` URL and a PDF page's base64 `data:` URL.

  Editing model: double-click a block to edit it in place (Valider/Annuler in the corner); for tables, double-click a *cell* rather than a row. Editing always shows raw Markdown/LaTeX source (no rich-text toggle). Confirming an edit that actually changed the text triggers `captureCorrection`, which snapshots the block, bbox, and image source and opens `CorrectionModal`; confirming the modal crops the image and posts to `/corrections`. A bbox drag alone (no text change) never triggers a correction capture, since there's no before/after text pair to record.

  Two behaviors worth knowing before touching any of this:
  - **Uncertain-content highlighting** (`utils/markdownHighlight.ts`): `==...==` markers from the backend are rendered as `<mark class="ocr-uncertain">` via the `remark-highlight-mark` plugin (a micromark-level syntax extension, registered alongside `remark-gfm`/`remark-math`), *not* a post-parse text search/replace — a regex approach breaks as soon as the marked span straddles a `$...$` formula, because `remark-math` has already split that text into separate AST nodes by the time a text-only regex would run. That still leaves one case `remark-highlight-mark` structurally cannot handle: `==...==` placed *inside* a `$...$`/`$$...$$` span (e.g. `$f(==5==) = ==12==$`) — `remark-math` treats everything between the dollar signs as opaque LaTeX source, so the `==` markers are never tokenized and get sent to KaTeX literally, rendering as two stray `=` signs. `preprocessMathHighlights` (with its `highlightUncertainInMathSource` helper) works around this by pre-processing the raw Markdown *before* it reaches `ReactMarkdown`, converting `==...==` found inside math delimiters into `\colorbox{#FDE3B8}{...}` — a KaTeX-native command — so the highlight renders inside the formula itself instead of leaking as literal text. Outside math spans, `remark-highlight-mark`/`<mark>` still handles it as before. Only applied to the read-only rendered Markdown, never to `editDraft`/`cellDraft` — editing must always show the true raw source.
  - **Table rendering** (`utils/tableMarkdown.ts` + `components/result/TableRow.tsx`): since the backend emits one block per table row, `groupBlocksForRender` groups consecutive table-row blocks into one visual `<table>` (header rendered once from the first row's own header line, via `parseTableRowCells`). Each row is an independent `TableDataRow` (`React.memo`, keyed on `block.id`), and each non-confidence cell is an independent `TableDataCell` (`React.memo`, `useMemo` on that cell's own text value only) — **not** one shared `<ReactMarkdown>` call for the whole table. This granularity exists specifically so that selecting a row or editing one cell never re-parses/re-typesets KaTeX for *any* other cell or row: `TableDataCell` reads whether *it* is the one being edited from `EditingCellContext` (changes only on double-click start/stop, not per keystroke) rather than from a prop threaded down from a memoized ancestor, and the live-typed value flows through a separate `CellDraftContext` (changes every keystroke) consumed only by the one active `CellEditor` — so a keystroke in one cell never invalidates any other cell's memo. Row/cell click handlers reaching `ResultScreen.tsx` (`handleRowClick`, `onCellDoubleClick`, etc.) must stay `useCallback`-stable (backed by "mirror refs" — `editingCellRef`/`cellDraftRef`/`blocksRef` — for handlers that need the *current* value without invalidating their own memoization) or the whole per-row/per-cell memoization breaks silently. Row selection (`handleRowClick`) is also debounced 300ms and cancelled by a same-cell double-click (`rowClickTimerRef`), because dispatching `SELECT_BLOCK` synchronously on the first click of a double-click re-renders/highlights the row between the two clicks, which the browser then fails to recognize as a `dblclick`. The "Confiance" column (column 0, injected by the backend) is excluded from cell editing. The cell editor's `<input>` uses `[font:inherit] h-full block` and `size={1}` so it matches the KaTeX cell's font/height and doesn't widen the column with its default intrinsic width.
  - **Known limitation**: editing a cell/block containing a complex formula (fraction, exponent) shows the raw LaTeX source rather than the rendered text, causing a visible layout jump on entering/leaving edit mode. There's no rich-text/raw-code toggle for this — it's accepted as-is.
- `src/types/index.ts` — shared types mirroring the backend's Pydantic schemas (`TranscriptionBlock`/`Block`, `BoundingBox`, `TranscriptionResult`/`OCRResult`, PDF job start/status types, correction request/response types). Keep these in sync manually when backend schemas change — there is no shared/generated type layer between the two projects.

Styling is Tailwind v4 via `@tailwindcss/vite` (no `tailwind.config.js` — v4 uses CSS-based config, see `src/index.css`/`App.css`). `src/index.css` also has manual `table`/`th`/`td` styling for `.markdown-content`, since Tailwind's preflight strips native table borders/spacing. Math rendering uses KaTeX exclusively; all icons in the app are inline hand-written SVGs (no icon library dependency).

## Known pending work

- PDF pages are transcribed **sequentially** in `_run_pdf_job` — parallelizing with `asyncio.gather` + a semaphore (now unblocked by the async Claude client) is the next planned speed improvement, along with Anthropic prompt caching on the system prompt (identical across every page/call).
- No rich-text/raw-code toggle for editing complex-formula cells (see "Known limitation" above) — accepted as a permanent product decision, not planned work.
- End-to-end manual verification of the corrections-collection flow (double-click → edit → confirm → modal → submit → verify the SQLite row and image file on disk) is still outstanding.

## Production readiness — before opening to ~50-100 concurrent users

Identified during a deployment-planning discussion (2026-08-13), not yet implemented. Ordered by priority:

1. ~~**Blocking event-loop calls**~~ **done** — `normalize_orientation`, `resize_for_vision` (PIL) and `convert_pdf_to_images` (PyMuPDF) now run via `await asyncio.to_thread(...)` in `transcription.py`, same pattern as `correction_store.save_correction` in `corrections.py`.
2. **No concurrency limit on Anthropic calls** — nothing throttles how many `call_anthropic_ocr` calls run at once, so a burst of concurrent uploads can blow through Anthropic's rate limits (429s) or spike cost with no alerting. Fix: a module-level `asyncio.Semaphore` (e.g. 5-8 slots) in `claude_service.py` around `client.messages.create(...)`, plus a spend/budget alert configured on the Anthropic account (outside the codebase).
3. ~~**`job_store.py` unbounded growth**~~ **done** — jobs now carry `created_at`, and `create_job` opportunistically purges `"done"`/`"error"` jobs older than `JOB_TTL_SECONDS` (default 4h) on every new job creation. Separately, the store remains process-local by design — since the app is a **multi-user SaaS** (not personal-use), this is only acceptable as long as the deployment is pinned to a **single instance, vertically scaled** (no autoscaling/multiple replicas); it becomes a hard blocker the moment horizontal scaling is needed, at which point it would need Redis or similar — not something to add prematurely.
4. **SQLite write concurrency (`correction_store.py`)** — corrections are a low-frequency user action (not the hot path), so no preemptive change is planned; if `database is locked` errors actually show up in production, the low-cost fix is `PRAGMA journal_mode=WAL` (concurrent readers + one writer) rather than migrating to a different database.
5. **Hardcoded config (blocks any deployment, independent of load)** — ~~`API_BASE` in the frontend~~ **done**: now `VITE_API_BASE_URL`, read in `src/services/apiClient.ts` (see also the API-key work below). Still outstanding: the CORS origins in `ocr-math-api/app/main.py` (`localhost:5173`/`5174`) are still hardcoded to local dev values — fix by driving them from an env var (e.g. `ALLOWED_ORIGINS`, read from `.env`).

Agreed starting order: #1 and #5 first (quick, low-risk, unblock deployment), then #2 before real traffic at this scale; #3 and #4 can wait and be monitored once in production.

## Frontend ↔ backend API key (implemented 2026-08-13)

The backend now requires a shared secret on every request to `/transcribe*` and `/corrections` (not on `/` or `/health`): header `X-API-Key`, checked by `app/security.py`'s `verify_api_key` FastAPI dependency against `APP_API_KEY` (`app/config.py`, distinct from `ANTHROPIC_API_KEY`). The frontend sends it automatically from `VITE_APP_API_KEY` via `src/services/apiClient.ts`'s `fetchApi`. Both `.env`/`.env.example` pairs (backend and `hakili-ocr/`) were updated accordingly; `hakili-ocr/src/vite-env.d.ts` types the new `import.meta.env.VITE_*` keys.

**Known limitation, by design, not a bug to fix**: a `VITE_*` variable is baked into the JS bundle at build time and is therefore visible to anyone who inspects the shipped frontend (view-source, Network tab) — it is *not* a secret once deployed. It blocks anonymous/automated direct hits on the bare API URL, but is not real user authentication and does not by itself prevent a motivated visitor from extracting the key and calling the API directly (see rate-limiting gap below).

## Security review — before dockerizing / deploying (2026-08-13, not yet implemented)

Audit done in preparation for containerizing the app. No Dockerfile/`.dockerignore` exists yet. Ordered by severity:

**Critical:**
1. ~~**No cap on PDF page count**~~ **done** — `convert_pdf_to_images` (`utils/image_utils.py`) now takes `max_pages` and rejects (`ValueError` → 400) before rasterizing any page if the PDF exceeds `MAX_PDF_PAGES` (default 600). PDF size limit is now also a dedicated `MAX_PDF_SIZE_MB` (default 500) rather than derived from the image limit.
2. **No `.dockerignore`** — must be created *before* any Dockerfile, otherwise a naive `COPY . .` would bake the real `.env` (live `ANTHROPIC_API_KEY` and `APP_API_KEY`) and `data/` (SQLite + user-submitted image crops) directly into image layers — a real secret/data leak if that image is ever pushed anywhere, even a "private" registry.

**Important:**
3. **No rate limiting on any endpoint** — combined with the `VITE_APP_API_KEY` limitation above, nothing stops a client who has extracted the key from the shipped frontend bundle from hammering `/transcribe` — direct, uncapped cost exposure via the Anthropic API. Needs a per-key/per-IP rate limit (e.g. `slowapi`, or handled at the reverse-proxy/CDN level).
4. **Generic exception handlers leak internal error text to the client** — e.g. `detail=f"Erreur inattendue : {exc}"` in `transcription.py`/`corrections.py` returns the raw Python exception message in the HTTP response instead of logging it server-side only and returning a generic message.
5. **Non-constant-time API key comparison** — `provided_key != settings.APP_API_KEY` in `app/security.py` is a theoretical timing-attack surface. Fix: `secrets.compare_digest(...)` instead of `!=`, cheap to apply.
6. **Dependencies unpinned, never audited** (see also the earlier backend audit above) — worth running `pip-audit` once before freezing a Docker image; a vulnerable transitive dependency is harder to patch once baked into a shipped image than in a dev environment.

**Docker best practices to build in from the first Dockerfile** (not fixes to existing code, just decisions to make when writing it):
7. Run the container as a non-root user.
8. Multi-stage build — don't ship build tools/pip cache/dev deps in the final image.
9. Pin the base image tag (and ideally digest), not a floating `python:3.x`.
10. `data/` must be a mounted volume, never copied into the image (same persistent-disk requirement already noted in the deployment discussion above).
11. Vite bakes `VITE_*` vars in at *build* time — a single built image can't be reused across environments (dev/staging/prod) with different backend URLs unless values are injected at container *startup* (e.g. an entrypoint script substituting a placeholder in the built JS/HTML) rather than at `docker build` time. Decide up front whether that flexibility is needed.

**Minor, not urgent:**
12. `allow_credentials=True` in the CORS middleware isn't needed (auth is header-based, not cookie-based) — harmless as-is but superfluous.
13. No security headers (CSP, etc.) — normally the responsibility of whatever sits in front of the app (nginx/Vercel/Railway), not the FastAPI app itself.
