from __future__ import annotations

import json
from pathlib import Path

import pytest
from qdrant_client import QdrantClient

from app import cli
from app.core.config import AppSettings
from app.imaging.encode import base64_to_image
from app.vector import QdrantStore
from tests.fakes import FakeEmbedder


@pytest.fixture
def memory_store(monkeypatch: pytest.MonkeyPatch) -> QdrantStore:
    settings = AppSettings(qdrant_collection="cli_pages", embed_dim=8)
    store = QdrantStore(settings=settings, client=QdrantClient(location=":memory:"))
    embedder = FakeEmbedder(dim=8)
    monkeypatch.setattr(cli, "get_embedder", lambda cfg=None: embedder)
    monkeypatch.setattr(cli, "QdrantStore", lambda cfg=None: store)
    return store


def test_index_creates_collection_and_points(
    memory_store: QdrantStore, tiny_pdf: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert cli.main(["index", str(tiny_pdf), "--no-save"]) == 0
    assert memory_store.exists()
    assert memory_store.vector_size() == 8
    assert memory_store.count() == 2
    payload = memory_store.search([1.0] * 8, limit=1)[0].payload
    assert "image_base64" not in payload
    assert str(payload["prompt_data_uri"]).startswith("data:image/jpeg;base64,")
    assert max(base64_to_image(str(payload["prompt_data_uri"])).size) <= 768
    assert "indexed pages 1-2" in capsys.readouterr().out


def test_index_respects_limit(
    memory_store: QdrantStore, tiny_pdf: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert cli.main(["index", str(tiny_pdf), "--no-save", "--limit", "1"]) == 0
    capsys.readouterr()
    assert memory_store.count() == 1


def test_index_missing_pdf(memory_store: QdrantStore, tmp_path: Path) -> None:
    assert cli.main(["index", str(tmp_path / "nope.pdf")]) == 2


def test_search_json_hides_base64(
    memory_store: QdrantStore, tiny_pdf: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    cli.main(["index", str(tiny_pdf), "--no-save"])
    capsys.readouterr()
    assert cli.main(["search", "net interest income", "--json"]) == 0
    results = json.loads(capsys.readouterr().out)
    assert len(results) == 2
    assert "image_base64" not in results[0]
    assert results[0]["doc_id"] == "tiny"
    assert results[0]["page_number"] in (1, 2)
    assert 0.0 <= results[0]["score"] <= 1.0


def test_search_json_with_base64(
    memory_store: QdrantStore, tiny_pdf: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    cli.main(["index", str(tiny_pdf), "--no-save"])
    capsys.readouterr()
    assert cli.main(["search", "x", "--json", "--with-base64"]) == 0
    results = json.loads(capsys.readouterr().out)
    assert results[0]["image_base64"]


def test_search_writes_hits_to_dir(
    memory_store: QdrantStore, tiny_pdf: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    cli.main(["index", str(tiny_pdf), "--no-save"])
    capsys.readouterr()
    out_dir = tmp_path / "hits"
    assert cli.main(["search", "x", "--save-dir", str(out_dir)]) == 0
    capsys.readouterr()
    saved = sorted(path.name for path in out_dir.glob("*.jpg"))
    assert len(saved) == 2
    assert all(name.startswith("tiny_p") for name in saved)


def test_search_missing_collection(memory_store: QdrantStore) -> None:
    assert cli.main(["search", "x"]) == 2


def test_qdrant_info_reports_missing(
    memory_store: QdrantStore, capsys: pytest.CaptureFixture[str]
) -> None:
    assert cli.main(["qdrant-info"]) == 0
    assert "missing" in capsys.readouterr().out


def test_qdrant_info_reports_ready(
    memory_store: QdrantStore, tiny_pdf: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    cli.main(["index", str(tiny_pdf), "--no-save"])
    capsys.readouterr()
    assert cli.main(["qdrant-info"]) == 0
    out = capsys.readouterr().out
    assert "ready" in out
    assert "Vector size: 8" in out
    assert "Points:      2" in out
