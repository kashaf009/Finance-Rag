# Finance RAG

> **Every answer, anchored to a page.**

Finance RAG is a multimodal Retrieval-Augmented Generation (RAG) system for question answering over a single SEC filing. It is designed for **auditability over fluency**: every supported answer must cite the document page, otherwise the system refuses to answer.

## Features

- 📄 PDF pages rendered as images instead of relying on text extraction.
- 🖼️ Each page normalized to **1024 × 1408**.
- 🔎 Gemini Embedding 2 for multimodal text/image embeddings.
- 🗄️ Qdrant vector database with **one vector per page**.
- 🤖 Multimodal LLM reads the retrieved page images.
- 📌 Answers contain inline page citations such as `[p86]`.
- 🛡️ Unsupported questions return a fixed refusal.
- 🔄 Self-RAG query rewriting and answer verification.
- 🔍 Full retrieval/generation trace exposed through the API.
- ⚡ Two selectable OpenAI-compatible LLM providers.

## Architecture

```text
                         ┌──────────────────┐
                         │      User        │
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │    FastAPI API   │
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │  Self-RAG Graph  │
                         └────────┬─────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
        ┌──────────┐       ┌────────────┐      ┌───────────┐
        │ Retrieve │──────▶│   Grade    │─────▶│  Rewrite  │
        └──────────┘       └────────────┘      └─────┬─────┘
              │                                      │
              │                                      │ retry
              │                                      ▼
              │                               ┌────────────┐
              └──────────────────────────────▶│  Generate  │
                                              └─────┬──────┘
                                                    │
                                                    ▼
                                              ┌────────────┐
                                              │ Self Check │
                                              └─────┬──────┘
                                                    │
                                      ┌─────────────┴─────────────┐
                                      ▼                           ▼
                               Supported Answer              Refusal
```

## How It Works

### 1. PDF Rendering

The source PDF is rendered page-by-page using Poppler.

Each page is:

1. Rendered at 200 DPI.
2. Trimmed.
3. Normalized to `1024 × 1408`.
4. Stored as JPEG.
5. Used as the same visual artifact for retrieval, LLM reasoning, and UI preview.

### 2. Multimodal Embeddings

Each page is embedded using:

```text
gemini-embedding-2
```

The embedding contains both textual and visual information.

Embedding dimension:

```text
1024
```

### 3. Qdrant

Qdrant stores one point for every document page.

Each point contains:

- Document ID
- Page number
- Render dimensions
- Page image payload
- Vector embedding

Distance metric:

```text
Cosine
```

### 4. Self-RAG

The RAG pipeline consists of:

```text
retrieve
   ↓
grade_documents
   ↓
rewrite_query ── retry
   ↓
generate
   ↓
self_check
```

#### Retrieve

The question is embedded and the most relevant pages are retrieved from Qdrant.

#### Grade Documents

Retrieved pages are evaluated for relevance.

If the top score is already too low, the system can short-circuit without calling the grader LLM.

#### Rewrite Query

If retrieval quality is insufficient, the query is broadened and retrieval is repeated.

Maximum rewrites are controlled by:

```text
RAG_MAX_REWRITES
```

#### Generate

The LLM receives the retrieved page images and generates an answer with inline citations:

```text
The CET1 capital ratio was 18.6% [p86, p87].
```

#### Self Check

The generated answer is checked against the same retrieved pages.

If the answer cannot be supported, the system returns:

```text
I could not find the information in the indexed pages of this document.
```

## Tech Stack

| Layer | Technology |
|---|---|
| API | FastAPI |
| Validation | Pydantic |
| Orchestration | LangGraph |
| Generation | LangChain OpenAI-compatible clients |
| LLM Provider 1 | Groq → `qwen/qwen3.8-27b` |
| LLM Provider 2 | Euron → `gemini-2.5-flash` |
| Embeddings | Google Gemini Embedding 2 |
| Vector Database | Qdrant |
| PDF Rendering | Poppler |
| Image Processing | Pillow |
| Frontend | Vite + React 18 |
| Language | TypeScript 5.6 |
| Styling | Tailwind CSS v3 |
| Animation | GSAP |
| Python | 3.13+ |
| Package Manager | uv |

## LLM Providers

The active generation provider can be changed at runtime.

The default image budget is **3 pages** per generation and self-check request
(`LLM_MAX_PAGES=3`), matching Groq's three-image limit. Retrieval still defaults
to **5 pages** (`RAG_TOP_K=5`). Euron supports a larger explicit image budget;
the configured budget must fit the active provider when switching models.

| Provider | Model |
|---|---|
| `groq` | `qwen/qwen3.8-27b` |
| `euron` | `gemini-2.5-flash` |

Switch provider using:

```http
POST /llm-provider
```

The frontend provider selector is driven by:

```http
GET /health
```

> The embedding model is not swappable without re-indexing the document.

## Image Resolution

Qdrant stores the normalized page at:

```text
1024 × 1408
```

The LLM receives a downscaled version controlled by:

```text
LLM_IMAGE_MAX_EDGE
```

Default:

```text
768
```

The original high-resolution page is still available through:

```http
GET /document/page/{n}
```

## Project Structure

```text
finance-rag/
│
├── backend/
│   ├── src/
│   │   └── app/
│   │       ├── api/
│   │       │   ├── schemas.py
│   │       │   ├── dependencies.py
│   │       │   └── routes/
│   │       │
│   │       ├── core/
│   │       │   ├── config.py
│   │       │   └── logging.py
│   │       │
│   │       ├── render/
│   │       │   └── PDF → page images
│   │       │
│   │       ├── imaging/
│   │       │   └── normalization, JPEG, base64
│   │       │
│   │       ├── embed/
│   │       │   └── Gemini Embedding 2
│   │       │
│   │       ├── vector/
│   │       │   └── Qdrant collection, upsert, search
│   │       │
│   │       ├── llm/
│   │       │   ├── provider resolution
│   │       │   ├── prompts
│   │       │   └── prompt-image encoding
│   │       │
│   │       ├── rag/
│   │       │   ├── nodes
│   │       │   ├── graph
│   │       │   ├── service
│   │       │   └── state
│   │       │
│   │       └── cli.py
│   │
│   ├── tests/
│   ├── pyproject.toml
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── hero/
│   │   │   ├── chat/
│   │   │   ├── document/
│   │   │   └── layout/
│   │   │
│   │   ├── hooks/
│   │   │   ├── useChat.ts
│   │   │   ├── useHealth.ts
│   │   │   └── usePreviewHit.ts
│   │   │
│   │   ├── lib/
│   │   │   ├── api.ts
│   │   │   ├── citations.ts
│   │   │   ├── document.ts
│   │   │   ├── trace.ts
│   │   │   └── gsap.ts
│   │   │
│   │   └── types/
│   │       └── api.ts
│   │
│   ├── package.json
│   └── vite.config.ts
│
├── docs/
│   └── JPM_SE_Annual_2023_140.pdf
│
├── docker-compose.yml
└── README.md
```

> `frontend/src/types/api.ts` is a hand-maintained mirror of the backend Pydantic schemas. Update both in the same commit when the API contract changes.

## Requirements

- Python **3.13+**
- [uv](https://docs.astral.sh/uv/)
- Node.js **20+**
- npm
- Poppler / `pdftoppm`
- Docker
- Docker Compose

## Quick Start

### 1. Start Qdrant

```bash
docker compose up -d qdrant
```

### 2. Install Backend

```bash
cd backend
uv sync
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Add your API keys:

```env
GOOGLE_API_KEY=your_google_api_key
GROQ_API_KEY=your_groq_api_key
EURON_API_KEY=your_euron_api_key
```

Only configure the provider(s) you intend to use.

### 4. Index the PDF

From the `backend` directory:

```bash
uv run python -m app.cli index ../docs/JPM_SE_Annual_2023_140.pdf
```

### 5. Start Backend

```bash
uv run python -m app.cli serve
```

Backend:

```text
http://127.0.0.1:8000
```

### 6. Start Frontend

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

## CLI Usage

### Search

```bash
uv run python -m app.cli search "net interest income 2023" --limit 5
```

### Chat

```bash
uv run python -m app.cli chat "What was the CET1 capital ratio in 2023?"
```

### Save Cited Output

```bash
uv run python -m app.cli chat \
  "What was the CET1 capital ratio in 2023?" \
  --save-dir ./cited
```

## API

Base URL:

```text
http://127.0.0.1:8000
```

### Health

```http
GET /health
```

Returns health/configuration information and is designed to avoid returning `5xx`.

### Collections

```http
GET /collections
```

Lists available Qdrant collections.

### Search

```http
POST /search
```

Limits:

```text
1–50
```

Default:

```text
5
```

Example:

```json
{
  "query": "net interest income 2023",
  "limit": 5
}
```

### Chat

```http
POST /chat
```

Limits:

```text
top_k: 1–20
```

The endpoint is blocking and does not stream responses.

Example:

```json
{
  "question": "What was the CET1 capital ratio in 2023?",
  "top_k": 5
}
```

Example response:

```json
{
  "question": "What was the CET1 capital ratio in 2023?",
  "query": "What was the CET1 capital ratio in 2023?",
  "answer": "In 2023, the CET1 capital ratio was 18.6% [p86, p87].",
  "supported": true,
  "rewrites": 0,
  "pages_considered": 3,
  "citations": [
    {
      "doc_id": "JPM_SE_Annual_2023_140",
      "page_number": 86,
      "score": 0.531,
      "image": "data:image/jpeg;base64,..."
    }
  ],
  "trace": [
    {
      "node": "retrieve",
      "query": "What was the CET1 capital ratio in 2023?",
      "hits": 3
    }
  ]
}
```

### List Document Pages

```http
GET /document/pages
```

### Get Document Page

```http
GET /document/page/{n}
```

Returns the original sharp page image.

## Error Handling

| HTTP Status | Meaning |
|---|---|
| `404` | Page not found / out-of-range page |
| `422` | Invalid request |
| `502` | RAG pipeline failure |
| `503` | LLM not configured |

The frontend maps errors into categories such as:

```text
network
timeout
aborted
not_configured
pipeline
validation
server
http
```



### Multimodal Requirement

Both LLM roles must support multimodal inputs because the grader also receives page renders.


## Development

### Backend Tests

```bash
cd backend
uv run pytest
```

## Current Dataset

The repository currently indexes:

```text
J.P. Morgan SE 2023 Annual Report
```

Document:

```text
JPM_SE_Annual_2023_140.pdf
```

Current index:

```text
Collection: finance_pages
Pages: 139
Vector dimensions: 1024
Distance: cosine
```

## Important Design Decisions

### Page Images Instead of PDF Text

Traditional RAG pipelines often extract PDF text and embed chunks.

Finance RAG instead treats each rendered PDF page as the retrieval unit.

This preserves:

- Tables
- Layout
- Charts
- Formatting
- Visual relationships
- Page-level evidence

### One Vector Per Page

The retrieval unit is intentionally the full page.

This makes citations deterministic:

```text
retrieved vector → page → evidence
```

### Same Artifact for Retrieval and UI

The page image used for multimodal reasoning is derived from the same rendered document artifact shown to the user.

This reduces discrepancies between:

```text
what the model sees
```

and:

```text
what the user sees
```

### Evidence Gaps Stay Visible

The system does not attempt to hide uncertainty.

If the indexed pages do not support the answer, the system returns the fixed refusal instead of hallucinating.


###


