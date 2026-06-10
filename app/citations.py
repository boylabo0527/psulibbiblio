"""Citation formatting in APA 7, MLA 9, Chicago (author-date), and Harvard."""
from __future__ import annotations

import re

STYLES = ("apa7", "mla9", "chicago", "harvard")


def _split_author(author: str) -> tuple[str, str]:
    """Return (last, initials_or_first). Handles 'Jane Q. Doe' and 'Doe, Jane Q.'."""
    author = (author or "").strip()
    if not author:
        return "", ""
    if "," in author:
        last, rest = [p.strip() for p in author.split(",", 1)]
        return last, rest
    parts = author.split()
    if len(parts) == 1:
        return parts[0], ""
    return parts[-1], " ".join(parts[:-1])


def _first_initials(first: str) -> str:
    parts = re.findall(r"[A-Za-z]+", first)
    return " ".join(p[0].upper() + "." for p in parts)


def format_citation(title: dict, style: str = "apa7") -> str:
    style = (style or "apa7").lower()
    t = (title.get("title") or "").strip().rstrip(".")
    author = (title.get("author") or "").strip()
    year = (title.get("year") or "n.d.").strip() or "n.d."
    publisher = (title.get("publisher") or "").strip().rstrip(".")
    last, first = _split_author(author)

    if style == "apa7":
        author_str = f"{last}, {_first_initials(first)}".strip().rstrip(",") if last else ""
        head = f"{author_str} ({year}). " if author_str else f"({year}). "
        tail = f"{t}. {publisher}." if publisher else f"{t}."
        return head + tail
    if style == "mla9":
        author_str = f"{last}, {first}".strip().rstrip(",") if last else ""
        head = f"{author_str}. " if author_str else ""
        return f"{head}{t}. {publisher}, {year}.".strip()
    if style == "chicago":
        author_str = f"{last}, {first}".strip().rstrip(",") if last else ""
        head = f"{author_str}. " if author_str else ""
        return f"{head}{year}. {t}. {publisher}.".strip()
    if style == "harvard":
        author_str = f"{last}, {_first_initials(first)}".strip().rstrip(",") if last else ""
        head = f"{author_str} {year}, " if author_str else f"{year}, "
        return f"{head}{t}, {publisher}.".strip().rstrip(",") + "."
    return format_citation(title, "apa7")
