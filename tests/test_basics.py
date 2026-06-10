"""Quick smoke tests for citation formatting and parsers."""
from pathlib import Path

from app import citations, parsers


ROOT = Path(__file__).resolve().parent.parent


def test_apa7_basic():
    out = citations.format_citation(
        {"title": "Architecture and Society", "author": "Jane Q. Doe", "year": "2022", "publisher": "Acme Press"},
        style="apa7",
    )
    assert "Doe, J. Q." in out
    assert "(2022)" in out
    assert "Architecture and Society" in out
    assert "Acme Press" in out


def test_mla9_basic():
    out = citations.format_citation(
        {"title": "A Title", "author": "Doe, Jane", "year": "2020", "publisher": "Pub"},
        style="mla9",
    )
    assert out.startswith("Doe, Jane.")
    assert "Pub, 2020." in out


def test_chicago_basic():
    out = citations.format_citation(
        {"title": "A Title", "author": "Jane Doe", "year": "2021", "publisher": "Pub"},
        style="chicago",
    )
    assert "Doe, Jane." in out
    assert "2021." in out


def test_harvard_basic():
    out = citations.format_citation(
        {"title": "A Title", "author": "Jane Q. Doe", "year": "2019", "publisher": "Pub"},
        style="harvard",
    )
    assert "Doe, J. Q. 2019" in out


def test_parse_perlego_sample():
    sample = ROOT / "data" / "sample_perlego_titles.xls"
    if not sample.exists():
        return  # sample is optional
    recs = parsers.parse_titles(sample)
    assert len(recs) > 0
    first = recs[0]
    assert first.get("title")
    assert first.get("isbn")  # online_identifier maps to isbn


def test_parse_psu_programs_csv():
    csv = ROOT / "data" / "psu_programs.csv"
    if not csv.exists():
        return
    recs = parsers.parse_courses(csv)
    assert len(recs) > 100
    assert any(r.get("campus") == "Main Campus" for r in recs)
