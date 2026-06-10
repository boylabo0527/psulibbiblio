"""File parsers for Perlego title lists and course descriptions.

Supports: .xlsx, .xls, .csv, .pdf, .docx
"""
from __future__ import annotations

import io
import re
from pathlib import Path
from typing import Any

import pandas as pd

# Canonical field -> list of acceptable header aliases (lowercased, stripped)
TITLE_ALIASES = {
    "title": ["title", "book title", "publication_title", "publication title", "name"],
    "author": ["author", "authors", "first_author", "author(s)", "first author"],
    "publisher": ["publisher", "publisher_name", "publisher name"],
    "year": ["year", "publication_year", "publication year", "pub year", "date"],
    "isbn": ["isbn", "online_identifier", "online identifier", "isbn-13", "isbn13", "eisbn"],
    "edition": ["edition", "ed."],
    "url": ["url", "title_url", "link"],
    "subjects": ["subjects", "subject", "tags", "keywords"],
}

COURSE_ALIASES = {
    "campus": ["campus"],
    "college": ["college", "school", "faculty"],
    "program": ["program", "programme", "program / degree", "degree"],
    "major": ["major", "track", "specialization", "major/ track / specialization", "major / track / specialization"],
    "course_code": ["course code", "code", "course_code"],
    "course_title": ["course title", "course", "title", "subject title"],
    "description": ["description", "course description", "syllabus"],
    "learning_outcomes": ["learning outcomes", "outcomes", "objectives", "course outcomes"],
    "keywords": ["keywords", "tags", "topics"],
    "enrollment": ["enrollment", "students", "enrolment", "no. of students"],
}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s)).strip().lower()


def _build_header_map(columns: list[str], aliases: dict[str, list[str]]) -> dict[str, str]:
    """Return {canonical: actual_column_name} for columns we recognize."""
    out: dict[str, str] = {}
    normed = {_norm(c): c for c in columns}
    for canonical, alts in aliases.items():
        for alt in alts:
            if alt in normed:
                out[canonical] = normed[alt]
                break
    return out


def _read_tabular(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path, dtype=str, keep_default_na=False)
    if suffix == ".xlsx":
        return pd.read_excel(path, engine="openpyxl", dtype=str)
    if suffix == ".xls":
        try:
            return pd.read_excel(path, engine="xlrd", dtype=str)
        except Exception:
            return pd.read_excel(path, engine="openpyxl", dtype=str)
    raise ValueError(f"Unsupported tabular format: {suffix}")


def _read_pdf_text(path: Path) -> str:
    from pypdf import PdfReader
    reader = PdfReader(str(path))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def _read_docx_text(path: Path) -> str:
    import docx
    d = docx.Document(str(path))
    return "\n".join(p.text for p in d.paragraphs)


def parse_titles(path: str | Path) -> list[dict[str, Any]]:
    """Parse a Perlego-style title list. Returns list of dicts with canonical keys."""
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix in {".csv", ".xlsx", ".xls"}:
        df = _read_tabular(path)
        df = df.fillna("")
        header_map = _build_header_map(list(df.columns), TITLE_ALIASES)
        if "title" not in header_map:
            raise ValueError(
                f"Could not find a title column in {path.name}. Columns: {list(df.columns)}"
            )
        records = []
        for _, row in df.iterrows():
            rec = {k: str(row[v]).strip() for k, v in header_map.items()}
            if not rec.get("title"):
                continue
            records.append(rec)
        return records
    if suffix == ".pdf":
        text = _read_pdf_text(path)
        return _records_from_freeform_text(text)
    if suffix == ".docx":
        text = _read_docx_text(path)
        return _records_from_freeform_text(text)
    raise ValueError(f"Unsupported title list format: {suffix}")


def _records_from_freeform_text(text: str) -> list[dict[str, Any]]:
    """Very lightweight extraction for PDF/DOCX bibliographies."""
    recs = []
    for line in text.splitlines():
        line = line.strip()
        if len(line) < 8:
            continue
        m = re.match(r"^(?P<author>[^.]+)\.\s*\((?P<year>\d{4})\)\.\s*(?P<title>[^.]+)\.\s*(?P<publisher>[^.]+)\.?$", line)
        if m:
            recs.append({
                "author": m.group("author").strip(),
                "year": m.group("year"),
                "title": m.group("title").strip(),
                "publisher": m.group("publisher").strip(),
            })
        elif " - " in line:
            parts = [p.strip() for p in line.split(" - ")]
            if len(parts) >= 2:
                recs.append({"title": parts[0], "author": parts[1] if len(parts) > 1 else ""})
    return recs


def parse_courses(path: str | Path) -> list[dict[str, Any]]:
    """Parse a course description file. Returns list of dicts with canonical keys."""
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix in {".csv", ".xlsx", ".xls"}:
        df = _read_tabular(path)
        df = df.fillna("")
        header_map = _build_header_map(list(df.columns), COURSE_ALIASES)
        records = []
        for _, row in df.iterrows():
            rec = {k: str(row[v]).strip() for k, v in header_map.items()}
            # require at least one substantive field
            if not (rec.get("course_title") or rec.get("course_code") or rec.get("program") or rec.get("description")):
                continue
            try:
                rec["enrollment"] = int(rec.get("enrollment") or 0)
            except ValueError:
                rec["enrollment"] = 0
            records.append(rec)
        return records
    if suffix == ".pdf":
        text = _read_pdf_text(path)
    elif suffix == ".docx":
        text = _read_docx_text(path)
    else:
        raise ValueError(f"Unsupported course file format: {suffix}")
    # Heuristic: treat each non-empty paragraph block as a course description.
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
    return [
        {
            "course_title": (b.splitlines()[0] if b else "")[:300],
            "description": b,
        }
        for b in blocks
    ]
