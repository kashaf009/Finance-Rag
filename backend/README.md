# Finance RAG

Self-RAG question answering over scanned bank annual reports. PDF pages are rendered to
images, embedded with Gemini Embedding 2, stored in Qdrant, and answered by a multimodal
`gemini-2.5-flash` model served through an OpenAI-compatible endpoint.

## Requirements

- Python 3.12+ and [uv](https://docs.astral.sh/uv/)
- Poppler (`pdftoppm`, `pdfinfo`) for PDF rendering
- Docker with Compose for Qdrant

## Setup

```bash
# 1. Dependencies
uv sync

# 2. Environment
cp .env.example .env    # then fill in GOOGLE_API_KEY and EURON_API_KEY

# 3. Qdrant
docker compose up -d qdrant
```

## Indexing a document

Place a PDF in `../docs/`, then render and index it:

```bash
uv run python -m app.cli render ../docs/JPM_SE_Annual_2023_140.pdf
uv run python -m app.cli index ../docs/JPM_SE_Annual_2023_140.pdf
uv run python -m app.cli qdrant-info
```

Indexing is incremental per page: re-running skips pages already stored, so indexing can be
resumed after an interruption.

## Querying from the CLI

```bash
uv run python -m app.cli search "net interest income 2023" --limit 5
uv run python -m app.cli chat "What was the CET1 capital ratio in 2023?"
uv run python -m app.cli chat "What was the CET1 capital ratio in 2023?" --json
uv run python -m app.cli chat "..." --save-dir ./cited
```

## HTTP API

```bash
uv run python -m app.cli serve            # http://127.0.0.1:8000, docs at /docs
```

The server binds to `127.0.0.1` and has **no authentication**; do not expose it publicly.

### `GET /health`

```bash
curl http://127.0.0.1:8000/health
```

```json
{
  "status": "ok",
  "qdrant_url": "http://localhost:6333",
  "collection": "finance_pages",
  "collection_ready": true,
  "points": 139,
  "llm_model": "gemini-2.5-flash",
  "llm_base_url": "https://api.euron.one/api/v1/euri",
  "embed_model": "gemini-embedding-2",
  "vector_size": 1024
}
```

`status` is `degraded` when Qdrant is unreachable or the collection is missing.

At startup, the API probes Qdrant, compiles the cached Self-RAG graph, and initializes
the Gemini SDK client. Chat and search reuse the warmed embedder and store. Warm-up
does not send embedding or LLM requests. Initialization failures are logged and the
API continues to start; embedding client creation can be retried on a later request.
Dependency caches are cleared at shutdown.

### `GET /collections`

```json
{ "name": "finance_pages", "exists": true, "vector_size": 1024, "points": 139, "distance": "Cosine" }
```

### `POST /search`

Pure vector retrieval, no generation. Each hit carries a JPEG data URI, downscaled at serve time to `llm_image_max_edge` (559x768 for this document). The Qdrant payload itself holds the full-resolution 1024x1408 file.

Search and chat share a process-local LRU cache of up to 256 prompt-image variants.
The cache keys include document/page identity, source image content, and encoding
settings, so re-indexed pages and changed image settings produce fresh images.

Prompt JPEGs use fast encoding (`optimize=False`) at `LLM_IMAGE_QUALITY`. This
reduces encoding CPU while preserving decoded pixels, with a larger JPEG payload.
`IMAGE_JPEG_OPTIMIZE` controls JPEG optimization for ingest artifacts.

Each Gemini embedder caches successful query embeddings in a 256-entry LRU.
Queries are whitespace-normalized while preserving case and punctuation. Chat,
search, and query rewrites reuse embeddings across requests handled by that
embedder instance.

```bash
curl -X POST http://127.0.0.1:8000/search \
  -H 'Content-Type: application/json' \
  -d '{"query": "net interest income 2023", "limit": 5}'
```

### `POST /chat`

Runs the full Self-RAG graph.

```bash
curl -X POST http://127.0.0.1:8000/chat \
  -H 'Content-Type: application/json' \
  -d '{"question": "What was the CET1 capital ratio in 2023?", "top_k": 5}'
```

```json
{
  "question": "What was the CET1 capital ratio in 2023?",
  "query": "What was the CET1 capital ratio in 2023?",
  "answer": "In 2023, the CET1 capital ratio was 18.6% [p86, p87].",
  "supported": true,
  "rewrites": 0,
  "pages_considered": 3,
  "citations": [{ "doc_id": "...", "page_number": 86, "score": 0.531, "image": "data:image/jpeg;base64,..." }],
  "trace": [{ "node": "retrieve", "query": "...", "hits": 3 }]
}
```

When the pipeline cannot ground an answer it returns the fixed refusal
`I could not find the information in the indexed pages of this document.` with
`supported: false` and no citations.

Errors: `422` invalid request, `502` pipeline failure, `503` LLM not configured.

## Self-RAG graph

```
START -> retrieve -> grade_documents
                         |-- relevant ------> generate -> self_check -> END
                         |-- not relevant -> rewrite_query -> retrieve
                                              (up to RAG_MAX_REWRITES, then generate)
```

- **retrieve** embeds the query, searches Qdrant, and prepares the prompt images needed
  downstream. Grading, generation, self-check, and citations reuse those same data URIs.
- **grade_documents** scores pages; a low top score short-circuits the grader LLM call.
- **rewrite_query** broadens the query and re-retrieves when grading fails. Scores below
  `RAG_REWRITE_SCORE_FLOOR` bypass rewrites and proceed to generation and self-check.
- **generate** answers from the attached page images, citing inline `[pN]` markers.
- **self_check** verifies the answer against the pages; unsupported or refused answers
  become the fixed refusal.

`trace` in the response records every node visit, so the rewrite behaviour is visible.

## Configuration

All settings come from `.env`; see `.env.example` for the full list. Frequently tuned:

| Variable | Default | Purpose |
| --- | --- | --- |
| `RAG_TOP_K` | `5` | Pages retrieved per attempt |
| `RAG_MAX_REWRITES` | `2` | Query rewrites before giving up |
| `RAG_RELEVANCE_THRESHOLD` | `0.35` | Minimum top score to consult the grader |
| `RAG_REWRITE_SCORE_FLOOR` | `0.32` | Skip rewrites below this top score; `-1` disables the cutoff |
| `LLM_MAX_PAGES` | `5` | Page images attached to each LLM call |
| `LLM_IMAGE_MAX_EDGE` | `768` | Prompt images downscaled to this max edge |
| `LLM_IMAGE_QUALITY` | `70` | JPEG quality for prompt images |
| `LLM_MAX_COMPLETION_TOKENS` | `2048` | Raise for long answers |

The rewrite floor was calibrated against live retrievals from the 139-page JPM report:
seven supported answers scored 0.481–0.539, while an unrelated weather query scored
0.306 and its two rewrites dropped to 0.295 and 0.292, ending in refusal. The next
observed low score was 0.339, so 0.32 cuts off the isolated low-score case while
preserving the measured borderline retrievals. Equality still permits rewrites.
Recalibrate this setting when changing the document or embedding model.

## Development

```bash
uv run ruff check .
uv run ruff format --check .
uv run pytest
```

## Architecture

```
src/app/
  core/      settings, env loading, logging
  render/    PDF -> PIL page images (pdf2image + Poppler)
  imaging/   normalization to 1024x1408, JPEG/base64 encoding
  embed/     Gemini Embedding 2 (text and image)
  vector/    Qdrant collection, upsert, search
  llm/       ChatOpenAI client, prompts, prompt-image encoding
  rag/       LangGraph nodes, graph, service
  api/       FastAPI schemas, dependencies, routes
  cli.py     render, index, search, qdrant-info, chat, serve
  main.py    FastAPI app factory
```
