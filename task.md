# Finance RAG live progress

## Goal

Show the RAG pipeline live in the chat while a question is being answered:
retrieving pages/chunks, checking relevance, refining the query when needed,
generating the answer, and verifying its grounding.

## Plan

- [x] Audit the backend Self-RAG graph, API, frontend chat hook, and chat panel.
- [x] Initialize a local Git repository because the project did not contain one.
- [x] Add a backend SSE endpoint for live RAG stage events.
- [x] Include retrieved page numbers and cosine scores in the retrieval event.
- [x] Keep the existing blocking `POST /chat` endpoint for compatibility.
- [x] Add a frontend SSE parser and use it for interactive chat requests.
- [x] Render a live, accessible pipeline timeline in the chat thinking state.
- [x] Add/update backend and frontend regression tests for streaming.
- [x] Run formatting, lint, typecheck, build, and test gates.
- [x] Allow the local Vite frontend to read health metadata through default CORS origins.
- [x] Review the diff and commit the completed work.
- [x] Receive approval and push the feature branch.

## Implementation notes

- Backend stream: `POST /chat/stream`.
- Stream format: server-sent events over a POST request; the final `complete`
  event contains the same response contract as `POST /chat`.
- Stage events are emitted from LangGraph state snapshots, so a stage is only
  marked complete after its real node has finished.
- Retrieval metadata is limited to query, page numbers, hit count, and scores;
  the final answer still carries the existing citations and trace.
- Local development CORS defaults to `localhost:5173` and `127.0.0.1:5173`, so
  the frontend can display the live collection and embedding metadata without
  requiring an extra `.env` setting.

## Verification log

- Backend tests: `137 passed`.
- Frontend tests: `155 passed`.
- Backend Ruff check and format check passed.
- Frontend typecheck, lint, and production build passed.
- Live `GET /health` confirmed `finance_pages`, `139` points,
  `gemini-embedding-2`, and `1024` dimensions; CORS now exposes those fields
  to the local frontend.
