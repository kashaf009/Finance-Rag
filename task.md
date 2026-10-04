# Chat Latency Optimization Plan

## Goal

Reduce end-to-end latency and perceived latency of a chat turn in the Finance RAG app.

## Scope decisions (settled)

| Decision | Choice | Rationale |
| --- | --- | --- |
| API contract | **No change** to the HTTP/SSE schema | Keeps existing clients and fixtures valid; every win below is internal |
| Concurrency | **Single user, keep synchronous handlers** | `async` conversion is a large diff with no benefit at current scale |
| `self_check` | **Stays blocking; stops re-encoding images** | Preserves the truthful `supported` field in the response |

Explicitly **out of scope**: token streaming (TTFT), `async def` conversion, message history / conversation memory, reranking, chat history in the prompt.

---

## Current shape of a request

`POST /chat/stream` runs the Self-RAG LangGraph (`backend/src/app/rag/graph.py:55-73`) with **five strictly sequential external round trips** on the happy path, and up to **twelve** when the query-rewrite loop runs.

```
POST /chat/stream  {question}
  └─ RagService.stream                                    service.py:168
       ├─ LangGraph .stream(stream_mode="values")          graph.py:57
       │    ├─ retrieve        nodes.py:100   embed + qdrant
       │    ├─ grade_documents nodes.py:114   LLM #1 (2 images)
       │    ├─ rewrite_query   nodes.py:158   LLM #2 (text only)   [loop x2]
       │    ├─ generate        nodes.py:180   LLM #3 (5 images)
       │    └─ self_check      nodes.py:212   LLM #4 (5 images)
       └─ _result_from_state → build_citations  service.py:110   N image re-encodes
```

Measured on the current stack (`frontend/src/lib/api.ts:23-31`): **19.5 s** for a supported answer, **33.9 s** for a refusal, **140–156 s** on Groq. Three cost centres dominate:

1. **Three serialized LLM calls, no token streaming.** The answer appears only after `generate` *and* `self_check` both finish.
2. **Seventeen redundant image re-encodes per request.** `to_prompt_data_uri` is stateless and recomputed for the same bytes up to three times.
3. **Frontend render churn.** A 10 Hz clock re-renders the entire panel and re-parses every already-rendered answer, ten times a second, for the whole request.

---

## Phase 0 — Backend CPU and network waste

No behaviour change. Safe to ship first and independently.

### 0.1 Cache the downscaled data URI per page — biggest safe win

`backend/src/app/llm/images.py:9` is a pure function with no memoization, and is called up to **seventeen times per request**:

| Caller | Line | Calls |
| --- | --- | --- |
| `grade_documents` → `_image_blocks(pages[:2])` | `nodes.py:139` | 2 |
| `generate` → `_image_blocks(pages[:5])` | `nodes.py:194` | 5 |
| `self_check` → `_image_blocks(pages[:5])` | `nodes.py:235` | 5 |
| `build_citations` | `service.py:126` | ≤5 |

`generate` and `self_check` process **byte-identical images with identical settings**. Each call is a base64 decode, `Image.open`, `.convert("RGB")`, a LANCZOS thumbnail, and a JPEG re-encode at `quality=70` with `optimize=True`.

**Change:** compute once per distinct page at `retrieve` (`nodes.py:105`) and carry the resulting URI on `RetrievedPage` so downstream nodes read it instead of recomputing. **17 encodes → 5.**

Additionally key a module-level cache on `(doc_id, page_number, edge, quality)` so repeat questions cost **zero** encodes. `RagService.search` (`service.py:157`) and `build_citations` (`service.py:126`) benefit from the same cache.

**Expected:** removes ~70% of per-request image CPU and the GIL pressure it causes.

**Implementation status (2026-10-04): complete; backend checks passed.**

- `RetrievedPage.prompt_data_uri` carries the prepared image through grading, generation, self-check, and citations. Retrieval prepares only the pages those consumers can use, even when `top_k` is larger.
- Search and chat share a process-local LRU cache capped at 256 variants. Keys include document/page identity, edge, quality, and source content to prevent stale evidence after re-indexing. Prompt JPEG optimization is fixed to `False` by feature 0.2.
- Verification: `uv run pytest` — **152 passed**; `uv run ruff check .` and `uv run ruff format --check .` — passed. Regression coverage includes cold/repeat turns, both chat endpoints, shared search/citation reuse, overlapping rewrite retrievals, settings/content changes, and eviction.

Offline benchmark: fixed 20-case set (10 supported, 5 refusals, 5 two-rewrite cases), each run cold and repeated, using five synthetic 1024×1408 financial-table images and deterministic embedder/store/LLM fakes. The benchmark uses the real Pillow encoder and full LangGraph; per-node timings and total wall time were captured before and after.

| Scenario | Before encodes | After cold encodes | After repeat encodes | Before cold median | After cold median | After repeat median |
| --- | --- | --- | --- | --- | --- | --- |
| Supported | 17 | 5 | 0 | 173.284 ms | 53.443 ms | 0.618 ms |
| Refusal | 7 | 5 | 0 | 72.144 ms | 52.999 ms | 0.586 ms |
| Two rewrites, same retrieved pages | 21 | 5 | 0 | 210.247 ms | 53.869 ms | 1.144 ms |

These are local image-processing/pipeline measurements. Live end-to-end verification is pending: the local API and Qdrant were offline when this feature was built.

### 0.2 Remove wasted work inside each encode

`backend/src/app/imaging/encode.py`:

- **Double colour conversion.** `base64_to_image` already returns `.convert("RGB")` (`encode.py:59`), then `image_to_jpeg_bytes` calls `.convert("RGB")` again (`encode.py:23`). Drop the redundant one.
- **JPEG optimization trades CPU for bytes.** `cfg.jpeg_optimize` defaults to `true`, and `optimize=True` adds encode CPU to reduce JPEG size. Pass `optimize=False` **from `to_prompt_data_uri` only** — these images go to an LLM, not to disk. Lower encode CPU with a larger upload; measure both. Do not change the ingest path.

**Implementation status (2026-10-04): complete; backend checks passed.**

- The JPEG encoder saves RGB images directly and converts other modes to RGB when needed. Tests compare the resulting ingest bytes against the previous encoder for RGB, RGBA, grayscale, palette, and CMYK inputs, with JPEG optimization both enabled and disabled.
- Prompt encoding always passes `optimize=False`. The prompt cache now uses only effective prompt-encoding settings, so changing the ingest optimization setting does not force a prompt-image re-encode.
- Verification: `uv run pytest` — **163 passed**; `uv run ruff check .` and `uv run ruff format --check .` — passed. Tests also verify decoded prompt pixels, redundant-conversion avoidance, and cold/repeat cache behavior.

Offline comparison against feature 0.1, using the same fixed 20-case set and synthetic page images described above:

| Scenario | Before JPEG encode median | After JPEG encode median | Before cold total median | After cold total median |
| --- | --- | --- | --- | --- |
| Supported | 6.633 ms | 2.974 ms | 50.618 ms | 47.626 ms |
| Refusal | 6.432 ms | 2.929 ms | 50.350 ms | 47.517 ms |
| Two rewrites, same retrieved pages | 6.618 ms | 2.936 ms | 51.409 ms | 48.175 ms |

JPEG encoding time fell by about **55%**, while supported-case local pipeline time fell by about **6%**. The five-image JPEG payload grew from **257,952 to 308,932 bytes** (**19.8%**); the corresponding data URIs grew from **344,055 to 412,027 bytes**. Cold requests still encode five images and repeats encode zero. These measurements use deterministic external-service fakes; live end-to-end verification remains pending.

### 0.3 LRU-cache query embeddings

`backend/src/app/embed/gemini.py:74` calls `embed_content` on every `retrieve` — roughly 100–300 ms of pure network wait, repeated verbatim for a repeated question. Wrap `embed_text` in a cache keyed on the normalized query string (`lru_cache`, `maxsize=256`).

Re-asking a question after a poor answer is a core flow in this UI, and each rewrite loop iteration embeds a fresh query that will not hit the cache — but the initial question and every repeat will.

### 0.4 Wire up the dead `LLM_MAX_RETRIES`

`cfg.llm_max_retries` appears in the client cache key (`llm/client.py:153`) but is **never passed to `ChatOpenAI`** (`client.py:185-193`). The OpenAI SDK default of `max_retries=2` silently applies, so a slow or failing call can be retried three times at up to `LLM_TIMEOUT=120 s` each — **360 s worst case**, invisible in configuration.

Pass it explicitly. This makes tail latency predictable and honours a setting that currently does nothing.

### 0.5 Skip futile query rewrites

At `nodes.py:123-130`, when the top retrieval score falls below `rag_relevance_threshold` (default `0.35`, `config.py:130`), the graph marks the result irrelevant and routes to `rewrite_query` (`graph.py:44-52`) — which is **more** expensive than what just failed: another LLM call plus a complete second `retrieve`. With `rag_max_rewrites=2` this is the 12-round-trip worst case, reached precisely when retrieval is least likely to improve.

**Change:** introduce a hard floor below which the pipeline skips the rewrite loop and goes straight to `generate`, letting the existing refusal path fire.

Do **not** guess the threshold value. Read the per-node `ms` timings already present in `trace` (see 1.9) across real questions, then pick the floor from the score distribution.

**Expected:** collapses the worst case from 12 round trips to 5.

### 0.6 Warm up on boot

`backend/src/app/main.py:18-33` probes Qdrant but never touches the embedder client or compiles the LangGraph. Because `RagService` is built lazily behind `lru_cache` (`api/deps.py:26`), the **first request pays for both**. Build the embedder and compile the graph in the lifespan handler.

---

## Phase 1 — Frontend render cost

### 1.1 The 10 Hz clock

`useElapsed` (`frontend/src/components/chat/ChatPanel.tsx:15-25`) holds its `setInterval(…, 100)` in `ChatPanel`'s own state (`:58`). That state is threaded into every turn (`:165`); `Turn` (`:232`) is a plain function component with **no `React.memo`**; so every tick re-renders the whole transcript.

Each re-render re-runs `AnswerMarkdown`, which re-parses its markdown from scratch — `react-markdown` builds a fresh `unified()` processor and re-parses the entire string on every render (`node_modules/react-markdown/lib/index.js:163-167`). There is no `memo` and no `useMemo` anywhere in that component.

With five answers in the transcript, that is roughly **50 remark parses per second** on the main thread for the full 20–160 s duration of a request.

**Change:** move the clock into a leaf `<Elapsed/>` component that owns its own state and reads `pending` from context or a ref, then delete the `elapsed` prop threading. The transcript stops re-rendering at 10 Hz entirely.

### 1.2 Memoize the turn subtree

Wrap `Turn` (`ChatPanel.tsx:232`), `AnswerMarkdown` (`AnswerMarkdown.tsx:21`), and `StageProgress` (`ChatPanel.tsx:356`) in `React.memo`.

### 1.3 Stabilize `react-markdown` props

`AnswerMarkdown.tsx:33-34` passes freshly allocated literals:

```tsx
remarkPlugins={[remarkGfm]}
components={{ a({ href, children, ...rest }) { /* ... */ } }}
```

New array and object identities on every render defeat memoization entirely. Hoist both to module scope.

### 1.4 Memoize derived markdown data

`byPage` (a `Map` rebuilt per render, `AnswerMarkdown.tsx:28`) and `linkifyMarkers(answer)` (a full regex pass with `matchAll`, `lib/citations.ts:84-95`) both recompute on every render. Wrap in `useMemo`.

### 1.5 Localize composer draft state

`draft` lives in `ChatPanel` (`ChatPanel.tsx:51`), so every keystroke in the textarea (`:177`) re-renders the entire transcript and re-parses every answer. Move `draft` into a child composer component.

### 1.6 Memoize the latency lookup

`ChatPanel.tsx:59` allocates, copies, and reverses the whole transcript on every tick just to find the last measured latency. Wrap in `useMemo` keyed on `turns`.

### 1.7 Fix the forced synchronous layout

The autoscroll effect (`ChatPanel.tsx:62-65`) reads `scrollHeight` and writes `scrollTop` on every `turns` identity change, with no guard and no `requestAnimationFrame`. Only scroll when already at the bottom, and wrap in `rAF`.

### 1.8 Move the clock out of the live region

The transcript is `role="log" aria-live="polite"` (`:145-146`) and the ticking clock sits inside it (`:258`), alongside a second `aria-live` span (`:257`). A live region mutating ten times a second is announcement churn. This is an accessibility bug as much as a perceived-latency one.

### 1.9 Surface the per-stage timings that already exist — best value for money

The backend **already records wall-clock milliseconds for every graph node** (`backend/src/app/rag/graph.py:22-41`) and returns them in `trace` on both `/chat` and `/chat/stream`.

The frontend **already has a parser for them** — `frontend/src/lib/trace.ts`, 182 lines, with `parseTrace`, `summarizeTrace`, and `traceHeadline`.

**Nothing imports `trace.ts`.** It is fully written, fully tested, and completely unused.

Rendering per-stage `ms` in `StageProgress` is therefore close to free, and it is the single best perception win in this phase: it turns an unexplained eighteen-second pause into a labelled, attributable one.

---

## Phase 2 — Payload and startup

### 2.1 Stop transferring full-resolution base64

`_page_fields` (`nodes.py:87-97`) reads `image_base64` from the Qdrant payload, and `page_payload` (`store.py:34-48`) stores the **full-resolution** 1024×1408 q85 JPEG — roughly 183 KB of base64 per page, so **~915 KB of JSON per `retrieve`**, and up to three times over on a rewrite loop.

Every one of those images is then downscaled to a 768 px long edge (`LLM_IMAGE_MAX_EDGE`) at q70 and largely discarded by the provider.

**Change:** store a pre-downscaled variant in the payload and drop the full-resolution copy. Cuts transfer by roughly 70% *and* eliminates the decode-and-resize entirely. Requires re-indexing via the existing CLI command.

### 2.2 Add response compression, excluding SSE

No `GZipMiddleware` is registered (`main.py:47-54`). **Caveat:** it must not be applied to `text/event-stream`, or it will buffer SSE frames and destroy incremental delivery. Register it so the stream route is excluded.

### 2.3 Cache the document page inventory

`GET /document/pages` (`routes.py:228-262`) re-globs the directory (`:246`), stats the PDF, and runs `Image.open()` to read dimensions (`:252-253`) on **every single hit**. Cache the result; the inventory only changes on re-index.

### 2.4 Collapse the health check round trips

`GET /health` (`routes.py:78-81`) and `GET /collections` (`:138-139`) each issue **three separate Qdrant round trips** where one would do. This matters more than it looks: `/health` gates the chat composer (`ChatPanel.tsx:55`), so it sits on the critical path of first interaction.

### 2.5 Stop shipping citation images the chat never renders

`Citation.image` (`service.py:126`) is populated with up to five base64 JPEGs and delivered in the `complete` SSE event, which the browser must `JSON.parse` at the exact moment the answer is supposed to appear. The chat panel renders only `page_number` and `score` (`ChatPanel.tsx:295-307`, `AnswerMarkdown.tsx:46-68`) — **the images are parsed and discarded.**

Measure the real payload on a live backend first (the local `backend/storage/` is empty and the test fixtures are stubbed), then drop the field from the chat response.

---

## Phase 3 — Frontend delivery

### 3.1 Code splitting

Measured from the current `dist/`: a **single 508 KB JS chunk** (164 KB gzip) and a single 125 KB CSS chunk. No route splitting, no `Suspense`, zero dynamic imports, and no `manualChunks` in `vite.config.ts`.

`/chat` therefore downloads GSAP (used only by the landing hero), the page reader, and the markdown toolchain up front. Add `React.lazy` route splitting for `/chat`, lazy-load `AnswerMarkdown`, and configure `manualChunks` to separate the `react-markdown` vendor graph.

### 3.2 Trim the fonts

`frontend/src/index.css:1-18` eagerly imports **108 font files totalling 1.37 MB** across three families — including **both `.woff` and `.woff2` for every single face**, plus cyrillic, greek, vietnamese, and extended subsets this app never renders.

Restrict to latin + `woff2`. Preload the two faces the chat transcript actually uses (`JetBrains Mono`, `Plus Jakarta Sans`).

### 3.3 Connection setup

Add `<link rel="preconnect">` to the API origin in `index.html` — there is none, so the cross-origin handshake to `127.0.0.1:8000` is paid cold on every fresh browser session.

---

## Bugs found while planning

Not latency work, but found in the same code and worth fixing.

### Groq is completely unusable right now

`groq.answer_max_images=3` (`llm/client.py:63`) but `llm_max_pages` defaults to `5` (`config.py:127`), so `build_llm` raises `LLMConfigError` (`client.py:168-174`) and the endpoint returns a hard **503**. No `.env` override exists, so selecting Groq from the UI always fails.

Fix by lowering `LLM_MAX_PAGES` to 3 or correcting the cap in the `Provider` table.

### Provider switching mutates process-global state

`set_active_provider` writes a module-global `_override` (`client.py:86, 97-105`) and calls `reset_llm_cache()`, which `.clear()`s the shared client dict (`client.py:198-199`) while other in-flight requests may still hold references to the stale clients. Acceptable single-user; unsafe the moment a second user exists. It is also unauthenticated (`routes.py:109-122`).

### Live secrets in the working tree

`backend/.env` contains live plaintext `GROQ_API_KEY`, `EURON_API_KEY`, and `GOOGLE_API_KEY`. Confirm `.env` is genuinely gitignored and not tracked, and rotate all three keys.

---

## Verification

Per-node `ms` timings already flow from `graph.py:22-41` into `trace` on both endpoints, so no new instrumentation is needed to measure the backend.

**Before starting**, capture a baseline over a fixed question set (say 20 questions spanning supported answers, refusals, and rewrite-loop cases) recording per-stage `ms` and total wall time.

**Per phase**, re-run the same set and compare per-stage and total. Success criteria:

| Phase | Criterion |
| --- | --- |
| 0 | Image encodes per request drops 17 → 5; repeat questions drop to 0 |
| 0 | `retrieve` stage `ms` measurably lower on repeats |
| 0 | Worst case (rewrite loop) drops from 12 round trips to 5 |
| 1 | Transcript does not re-render while the clock ticks — confirm via React DevTools |
| 1 | Per-stage `ms` visible in `StageProgress` |
| 2 | `retrieve` transfer bytes drop ~70% after re-index |
| 3 | `/chat` initial JS meaningfully under 164 KB gzip |

Frontend checks: `npm run lint`, `npm run test` (Vitest), `npm run build`.
Backend checks: `pytest` in `backend/`.

---

## Deferred

Deliberately excluded from this plan, recorded so they are not lost:

- **Token streaming (TTFT).** Still the single largest remaining perceived-latency lever. Requires `answer_model().stream()`, a new additive SSE `delta` event, and frontend token rendering. Excluded here only because the API contract was scoped to stay fixed.
- **`async def` conversion.** `chat_stream` is a `def` handler wrapping a synchronous generator (`routes.py:164`), so Starlette pins one anyio worker thread for the entire pipeline — a ceiling of roughly 40 concurrent chats, hit sooner under GIL pressure from the image work. Mitigable cheaply with multiple uvicorn workers if concurrency ever matters.
- **Conversational memory.** The pipeline is entirely stateless (`rag/state.py:16-26` has no history field; `ChatRequest` carries only `question`). Follow-up questions like "and what about 2022?" get no referential context, which both hurts answer quality and under-specifies the retrieval query — likely driving the expensive `rewrite_query` path more often than necessary. If added, route it through the existing `query` field via question rewriting rather than by re-sending a message list, so prompt size does not grow.
- **Parallelising independent calls.** `grade_documents` and the inputs to the first `generate` are independent once `retrieve` returns.
- **Reranking.** Ordering is raw Qdrant cosine with no reranker; `rag_relevance_threshold` is only a score cutoff (`nodes.py:123-130`).
