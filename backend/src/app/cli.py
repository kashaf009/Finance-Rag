from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import replace
from pathlib import Path

from PIL import Image

from app.core.config import AppSettings, get_settings
from app.core.env import load_env
from app.core.logging import setup_logging
from app.embed import get_embedder
from app.imaging.encode import base64_to_bytes, bytes_to_base64, image_to_jpeg_bytes
from app.imaging.normalize import normalize_page
from app.llm import LLMConfigError
from app.models import PageArtifact, RenderedPage
from app.rag import RagError, RagService
from app.render.pdf import iter_page_chunks, page_count
from app.vector import QdrantStore, VectorPoint, page_payload, page_point_id

DEFAULT_SAMPLE_CHARS = 64


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="finance-rag", description="Finance RAG utilities")
    sub = parser.add_subparsers(dest="command", required=True)

    info = sub.add_parser("info", help="Print PDF page count")
    info.add_argument("pdf", type=Path)

    render = sub.add_parser("render", help="Render a PDF to normalized page images")
    _add_render_args(render)
    render.add_argument("--out", type=Path, default=None, help="Output directory")
    render.add_argument("--no-save", action="store_true", help="Do not write JPEG files")
    render.add_argument(
        "--base64-sample",
        type=int,
        default=DEFAULT_SAMPLE_CHARS,
        help="Characters of base64 to show for the first page (0 to disable)",
    )

    index = sub.add_parser("index", help="Render, embed and upsert a PDF into Qdrant")
    _add_render_args(index)
    _add_embed_args(index)
    index.add_argument("--no-save", action="store_true", help="Do not write JPEG files")
    index.add_argument("--recreate", action="store_true", help="Recreate the collection first")
    index.add_argument("--batch-size", type=int, default=64, help="Qdrant upsert batch size")

    search = sub.add_parser("search", help="Search indexed pages with a text query")
    search.add_argument("query")
    search.add_argument("--limit", type=int, default=5, help="Number of results")
    _add_embed_args(search, include_dim=False)
    search.add_argument("--save-dir", type=Path, default=None, help="Write hit pages here")
    search.add_argument("--with-base64", action="store_true", help="Include base64 in --json")
    search.add_argument("--json", action="store_true", help="Emit JSON results")

    store_info = sub.add_parser("qdrant-info", help="Show Qdrant collection status")
    store_info.add_argument("--collection", default=None)

    chat = sub.add_parser("chat", help="Ask a question using the Self-RAG pipeline")
    chat.add_argument("question")
    chat.add_argument("--top-k", type=int, default=None, help="Pages to retrieve")
    chat.add_argument("--json", action="store_true", help="Emit JSON output")
    chat.add_argument("--save-dir", type=Path, default=None, help="Write cited pages here")

    serve = sub.add_parser("serve", help="Run the FastAPI server")
    serve.add_argument("--host", default=None)
    serve.add_argument("--port", type=int, default=None)
    serve.add_argument("--reload", action="store_true")
    return parser


def _add_render_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--first", type=int, default=None, help="First page (1-based)")
    parser.add_argument("--last", type=int, default=None, help="Last page (inclusive)")
    parser.add_argument("--limit", type=int, default=None, help="Process at most N pages")
    parser.add_argument("--chunk-pages", type=int, default=None)
    parser.add_argument("--dpi", type=int, default=None)
    parser.add_argument("--trim", action="store_true", help="Trim whitespace margins")


def _add_embed_args(parser: argparse.ArgumentParser, *, include_dim: bool = True) -> None:
    parser.add_argument("--collection", default=None, help="Qdrant collection name")
    parser.add_argument("--model", default=None, help="Embedding model")
    parser.add_argument("--workers", type=int, default=None, help="Concurrent embed requests")
    if include_dim:
        parser.add_argument("--dim", type=int, default=None, help="Embedding dimension")


def _settings_with(args: argparse.Namespace) -> AppSettings:
    overrides = {
        "qdrant_collection": getattr(args, "collection", None),
        "embed_model": getattr(args, "model", None),
        "embed_workers": getattr(args, "workers", None),
        "embed_dim": getattr(args, "dim", None),
    }
    clean = {key: value for key, value in overrides.items() if value is not None}
    return replace(get_settings(), **clean) if clean else get_settings()


def _resolve_range(args: argparse.Namespace, total: int) -> tuple[int, int]:
    first = args.first or 1
    last = args.last if args.last is not None else total
    if args.limit is not None:
        last = min(last, first + args.limit - 1)
    return first, min(last, total)


def _artifact(page_number: int, image: Image.Image, jpeg: bytes) -> PageArtifact:
    return PageArtifact(
        page_number=page_number,
        base64=bytes_to_base64(jpeg),
        width=image.width,
        height=image.height,
    )


def _info(args: argparse.Namespace) -> int:
    if not args.pdf.is_file():
        print(f"error: PDF not found: {args.pdf}", file=sys.stderr)
        return 2
    print(page_count(args.pdf))
    return 0


def _render(args: argparse.Namespace) -> int:
    cfg = get_settings()
    if not args.pdf.is_file():
        print(f"error: PDF not found: {args.pdf}", file=sys.stderr)
        return 2

    total = page_count(args.pdf)
    first, last = _resolve_range(args, total)
    out_dir = (args.out or cfg.storage_dir) / args.pdf.stem
    write_files = not args.no_save

    print(f"PDF:     {args.pdf}")
    print(f"Pages:   {total} (rendering {first}-{last})")
    if write_files:
        out_dir.mkdir(parents=True, exist_ok=True)
        print(f"Output:  {out_dir}")
    print(f"{'page':>5}  {'size':>11}  {'jpeg':>8}  {'b64':>9}  file")

    started = time.perf_counter()
    rendered = 0
    total_bytes = 0
    sample: str | None = None

    for chunk_start, images in iter_page_chunks(
        args.pdf,
        chunk_pages=args.chunk_pages,
        first_page=first,
        last_page=last,
        dpi=args.dpi,
    ):
        for offset, image in enumerate(images):
            page_number = chunk_start + offset
            page = RenderedPage.from_image(page_number, image)
            normalized = normalize_page(page.image, trim=args.trim)
            payload = image_to_jpeg_bytes(normalized)
            if sample is None and args.base64_sample > 0:
                sample = bytes_to_base64(payload)

            name = f"page_{page_number:04d}.jpg"
            if write_files:
                (out_dir / name).write_bytes(payload)

            rendered += 1
            total_bytes += len(payload)
            print(
                f"{page_number:>5}  {normalized.width:>5}x{normalized.height:<5}  "
                f"{len(payload) / 1024:>6.1f}KB  {len(payload) * 4 // 3:>8}  "
                f"{name if write_files else '-'}"
            )

    elapsed = time.perf_counter() - started
    print(
        f"Done: {rendered} pages, {total_bytes / 1024 / 1024:.2f} MB, "
        f"{elapsed:.1f}s ({rendered / elapsed if elapsed else 0:.1f} pages/s)"
    )
    if sample is not None:
        print(f"base64 sample (page {first}): {sample[: args.base64_sample]}...")
    return 0


def _index(args: argparse.Namespace) -> int:
    cfg = _settings_with(args)
    if not args.pdf.is_file():
        print(f"error: PDF not found: {args.pdf}", file=sys.stderr)
        return 2

    total = page_count(args.pdf)
    first, last = _resolve_range(args, total)
    doc_id = args.pdf.stem
    out_dir = cfg.storage_dir / doc_id
    write_files = not args.no_save

    embedder = get_embedder(cfg)
    store = QdrantStore(cfg)
    store.ensure_collection(dim=embedder.dim, recreate=args.recreate)
    if write_files:
        out_dir.mkdir(parents=True, exist_ok=True)

    print(f"PDF:        {args.pdf}")
    print(f"Collection: {store.collection} (dim={embedder.dim}, model={cfg.embed_model})")
    print(f"Pages:      {total} (indexing {first}-{last})")

    started = time.perf_counter()
    indexed = 0
    for chunk_start, images in iter_page_chunks(
        args.pdf,
        chunk_pages=args.chunk_pages,
        first_page=first,
        last_page=last,
        dpi=args.dpi,
    ):
        rendered: list[tuple[int, Image.Image, bytes]] = []
        for offset, image in enumerate(images):
            page_number = chunk_start + offset
            normalized = normalize_page(
                RenderedPage.from_image(page_number, image).image, trim=args.trim
            )
            payload = image_to_jpeg_bytes(normalized)
            if write_files:
                (out_dir / f"page_{page_number:04d}.jpg").write_bytes(payload)
            rendered.append((page_number, normalized, payload))

        vectors = embedder.embed_images([image for _, image, _ in rendered])
        points = [
            VectorPoint(
                id=page_point_id(doc_id, page_number),
                vector=vector,
                payload=page_payload(
                    _artifact(page_number, image, payload), doc_id=doc_id, source=str(args.pdf)
                ),
            )
            for (page_number, image, payload), vector in zip(rendered, vectors, strict=True)
        ]
        store.upsert(points, batch_size=args.batch_size)
        indexed += len(points)
        print(f"  indexed pages {chunk_start}-{chunk_start + len(points) - 1}")

    elapsed = time.perf_counter() - started
    print(
        f"Done: {indexed} pages, {store.count()} points in '{store.collection}', "
        f"{elapsed:.1f}s ({indexed / elapsed if elapsed else 0:.1f} pages/s)"
    )
    return 0


def _search(args: argparse.Namespace) -> int:
    cfg = _settings_with(args)
    embedder = get_embedder(cfg)
    store = QdrantStore(cfg)
    if not store.exists():
        print(f"error: collection '{store.collection}' not found", file=sys.stderr)
        return 2

    hits = store.search(embedder.embed_text(args.query, query=True), limit=args.limit)
    results = [
        {
            "score": hit.score,
            "doc_id": (hit.payload or {}).get("doc_id"),
            "page_number": (hit.payload or {}).get("page_number"),
            "width": (hit.payload or {}).get("width"),
            "height": (hit.payload or {}).get("height"),
            "image_base64": (hit.payload or {}).get("image_base64"),
        }
        for hit in hits
    ]

    if args.save_dir is not None:
        args.save_dir.mkdir(parents=True, exist_ok=True)
        for result in results:
            encoded = result["image_base64"]
            if encoded:
                name = f"{result['doc_id']}_p{result['page_number']:04d}.jpg"
                (args.save_dir / name).write_bytes(base64_to_bytes(encoded))

    if args.json:
        output = (
            results
            if args.with_base64
            else [
                {key: value for key, value in result.items() if key != "image_base64"}
                for result in results
            ]
        )
        print(json.dumps(output, indent=2))
        return 0

    print(f"query: {args.query!r}  ({len(results)} hits)")
    for rank, result in enumerate(results, start=1):
        print(
            f"{rank:>2}  score={result['score']:.4f}  "
            f"{result['doc_id']} p{result['page_number']}  "
            f"{result['width']}x{result['height']}"
        )
    return 0


def _chat(args: argparse.Namespace) -> int:
    try:
        result = RagService().answer(args.question, top_k=args.top_k)
    except (RagError, LLMConfigError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(
            json.dumps(
                {
                    "question": result.question,
                    "query": result.query,
                    "answer": result.answer,
                    "supported": result.supported,
                    "rewrites": result.rewrites,
                    "pages_considered": result.pages_considered,
                    "citations": [
                        {
                            "doc_id": citation.doc_id,
                            "page_number": citation.page_number,
                            "score": citation.score,
                            "image": citation.image,
                        }
                        for citation in result.citations
                    ],
                    "trace": result.trace,
                },
                indent=2,
            )
        )
        return 0

    print(f"Q: {result.question}")
    print(f"   query={result.query!r} rewrites={result.rewrites} pages={result.pages_considered}")
    print(f"A: {result.answer}")
    if result.citations:
        print("Citations:")
        for citation in result.citations:
            print(f"  p{citation.page_number} {citation.doc_id} score={citation.score:.3f}")
    if args.save_dir is not None and result.citations:
        args.save_dir.mkdir(parents=True, exist_ok=True)
        for citation in result.citations:
            name = f"{citation.doc_id}_p{citation.page_number:04d}.jpg"
            (args.save_dir / name).write_bytes(base64_to_bytes(citation.image.partition(",")[2]))
    for step in result.trace:
        print(f"  trace: {step}")
    return 0


def _serve(args: argparse.Namespace) -> int:
    import uvicorn

    cfg = get_settings()
    host = args.host or cfg.api_host
    port = args.port or cfg.api_port
    print(f"Serving Finance RAG API on http://{host}:{port} (docs at /docs)")
    uvicorn.run("app.main:app", host=host, port=port, reload=args.reload)
    return 0


def _qdrant_info(args: argparse.Namespace) -> int:
    cfg = _settings_with(args)
    store = QdrantStore(cfg)
    print(f"URL:         {cfg.qdrant_url}")
    print(f"Collection:  {store.collection}")
    if not store.exists():
        print("Status:      missing")
        return 0
    print("Status:      ready")
    print(f"Vector size: {store.vector_size()}")
    print(f"Points:      {store.count()}")
    return 0


_COMMANDS = {
    "info": _info,
    "render": _render,
    "index": _index,
    "search": _search,
    "qdrant-info": _qdrant_info,
    "chat": _chat,
    "serve": _serve,
}


def main(argv: list[str] | None = None) -> int:
    load_env()
    args = _build_parser().parse_args(argv)
    setup_logging(get_settings().log_level)
    handler = _COMMANDS.get(args.command)
    return handler(args) if handler else 1


if __name__ == "__main__":
    raise SystemExit(main())
