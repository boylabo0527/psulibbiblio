"""FastAPI application: upload, match, browse, export."""
from __future__ import annotations

import os
import shutil
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Query
from fastapi.responses import HTMLResponse, JSONResponse, Response, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import or_, and_
from sqlalchemy.orm import Session

from . import models, parsers, matcher, citations, exports
from .db import SessionLocal, init_db, get_db
from .seed import seed_programs

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"
UPLOAD_DIR = ROOT / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="PSU Bibliography Generator", version="0.1.0")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.on_event("startup")
def _startup() -> None:
    init_db()
    # Seed PSU programs on first launch.
    with SessionLocal() as db:
        if db.query(models.Course).count() == 0:
            seed_programs()


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return HTMLResponse((STATIC_DIR / "index.html").read_text(encoding="utf-8"))


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Uploads
# ---------------------------------------------------------------------------
def _save_upload(upload: UploadFile) -> Path:
    suffix = Path(upload.filename or "upload.bin").suffix
    fd, tmp = tempfile.mkstemp(prefix="upload_", suffix=suffix, dir=str(UPLOAD_DIR))
    os.close(fd)
    tmp_path = Path(tmp)
    with tmp_path.open("wb") as f:
        shutil.copyfileobj(upload.file, f)
    return tmp_path


@app.post("/api/upload/titles")
def upload_titles(file: UploadFile = File(...), db: Session = Depends(get_db)) -> dict:
    path = _save_upload(file)
    try:
        records = parsers.parse_titles(path)
    except Exception as e:
        raise HTTPException(400, f"Failed to parse titles: {e}")
    finally:
        try:
            path.unlink()
        except OSError:
            pass

    inserted = 0
    skipped = 0
    for rec in records:
        # de-dupe by (title, author, year) OR by ISBN
        isbn = (rec.get("isbn") or "").strip()
        title = (rec.get("title") or "").strip()
        if not title:
            skipped += 1
            continue
        q = db.query(models.Title)
        if isbn:
            existing = q.filter(models.Title.isbn == isbn).first()
        else:
            existing = q.filter(
                models.Title.title == title,
                models.Title.author == (rec.get("author") or ""),
                models.Title.year == (rec.get("year") or ""),
            ).first()
        if existing:
            skipped += 1
            continue
        db.add(models.Title(
            title=title,
            author=rec.get("author") or "",
            publisher=rec.get("publisher") or "",
            year=rec.get("year") or "",
            isbn=isbn,
            edition=rec.get("edition") or "",
            url=rec.get("url") or "",
            raw_subjects=rec.get("subjects") or "",
        ))
        inserted += 1
    db.commit()
    return {"received": len(records), "inserted": inserted, "skipped": skipped}


@app.post("/api/upload/courses")
def upload_courses(file: UploadFile = File(...), db: Session = Depends(get_db)) -> dict:
    path = _save_upload(file)
    try:
        records = parsers.parse_courses(path)
    except Exception as e:
        raise HTTPException(400, f"Failed to parse courses: {e}")
    finally:
        try:
            path.unlink()
        except OSError:
            pass
    inserted = 0
    for rec in records:
        db.add(models.Course(
            campus=rec.get("campus") or "",
            college=rec.get("college") or "",
            program=rec.get("program") or "",
            major=rec.get("major") or "",
            course_code=rec.get("course_code") or "",
            course_title=rec.get("course_title") or rec.get("program") or "Untitled Course",
            description=rec.get("description") or "",
            learning_outcomes=rec.get("learning_outcomes") or "",
            keywords=rec.get("keywords") or "",
            enrollment=int(rec.get("enrollment") or 0),
        ))
        inserted += 1
    db.commit()
    return {"received": len(records), "inserted": inserted}


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------
@app.post("/api/match/run")
def run_match(
    top_k: int = 10,
    min_score: float = 0.05,
    db: Session = Depends(get_db),
) -> dict:
    course_rows = db.query(models.Course).all()
    title_rows = db.query(models.Title).all()
    if not course_rows or not title_rows:
        raise HTTPException(400, "Need at least one course and one title before matching.")
    courses = [
        {
            "id": c.id, "course_title": c.course_title or "", "description": c.description or "",
            "learning_outcomes": c.learning_outcomes or "", "keywords": c.keywords or "",
            "major": c.major or "", "program": c.program or "", "college": c.college or "",
        }
        for c in course_rows
    ]
    titles = [
        {
            "id": t.id, "title": t.title or "", "author": t.author or "",
            "publisher": t.publisher or "", "raw_subjects": t.raw_subjects or "",
        }
        for t in title_rows
    ]
    results = matcher.match(courses, titles, top_k=top_k, min_score=min_score)
    # Replace prior auto matches (keep manual overrides).
    db.query(models.Match).filter(models.Match.overridden == 0).delete()
    db.commit()
    for r in results:
        # avoid colliding with manually-overridden rows
        existing = db.query(models.Match).filter(
            models.Match.course_id == r["course_id"],
            models.Match.title_id == r["title_id"],
        ).first()
        if existing:
            continue
        db.add(models.Match(
            course_id=r["course_id"], title_id=r["title_id"],
            score=r["score"], rank=r["rank"], explanation=r["explanation"],
        ))
    db.commit()
    return {"matches": len(results), "courses": len(courses), "titles": len(titles)}


@app.post("/api/match/override")
def override_match(payload: dict, db: Session = Depends(get_db)) -> dict:
    course_id = int(payload.get("course_id"))
    title_id = int(payload.get("title_id"))
    keep = bool(payload.get("keep", True))
    row = db.query(models.Match).filter(
        models.Match.course_id == course_id,
        models.Match.title_id == title_id,
    ).first()
    if keep:
        if not row:
            row = models.Match(course_id=course_id, title_id=title_id, score=1.0, rank=0,
                               explanation="Manual override", overridden=1)
            db.add(row)
        else:
            row.overridden = 1
    else:
        if row:
            db.delete(row)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Browse / filter / bibliography
# ---------------------------------------------------------------------------
def _filtered_query(
    db: Session,
    campus: Optional[str], college: Optional[str], program: Optional[str],
    course: Optional[str], author: Optional[str], publisher: Optional[str],
    year: Optional[str],
):
    q = (
        db.query(models.Match, models.Course, models.Title)
        .join(models.Course, models.Match.course_id == models.Course.id)
        .join(models.Title, models.Match.title_id == models.Title.id)
    )
    if campus: q = q.filter(models.Course.campus == campus)
    if college: q = q.filter(models.Course.college == college)
    if program: q = q.filter(models.Course.program == program)
    if course: q = q.filter(models.Course.course_title.like(f"%{course}%"))
    if author: q = q.filter(models.Title.author.like(f"%{author}%"))
    if publisher: q = q.filter(models.Title.publisher.like(f"%{publisher}%"))
    if year: q = q.filter(models.Title.year == year)
    return q


@app.get("/api/recommendations")
def recommendations(
    campus: Optional[str] = None,
    college: Optional[str] = None,
    program: Optional[str] = None,
    course: Optional[str] = None,
    author: Optional[str] = None,
    publisher: Optional[str] = None,
    year: Optional[str] = None,
    style: str = "apa7",
    db: Session = Depends(get_db),
) -> dict:
    rows = _filtered_query(db, campus, college, program, course, author, publisher, year).all()

    # Aggregate copies per title (across all matching courses)
    title_courses: dict[int, set[int]] = defaultdict(set)
    title_enrollment: dict[int, int] = defaultdict(int)
    for _m, c, t in rows:
        title_courses[t.id].add(c.id)
        title_enrollment[t.id] += int(c.enrollment or 0)

    rec_rows: list[dict] = []
    bibliography: dict[str, list[str]] = defaultdict(list)
    for m, c, t in rows:
        n_courses = len(title_courses[t.id])
        copies = matcher.recommend_copies(n_courses, title_enrollment[t.id])
        rec_rows.append({
            "Campus": c.campus or "",
            "College": c.college or "",
            "Program": c.program or "",
            "Course": c.course_title or "",
            "Book Title": t.title or "",
            "Author": t.author or "",
            "Publication Year": t.year or "",
            "Publisher": t.publisher or "",
            "Number of Copies": copies,
        })
        cite = citations.format_citation({
            "title": t.title, "author": t.author, "year": t.year, "publisher": t.publisher,
        }, style=style)
        key = f"{c.campus} | {c.college} | {c.program} | {c.course_title}"
        bibliography[key].append(cite)

    # Sort the master table per spec.
    rec_rows.sort(key=lambda r: (
        r["Campus"], r["College"], r["Program"], r["Course"], r["Book Title"]
    ))
    return {"rows": rec_rows, "bibliography": bibliography}


@app.get("/api/facets")
def facets(db: Session = Depends(get_db)) -> dict:
    def distinct(col):
        return sorted({v for (v,) in db.query(col).distinct() if v})
    return {
        "campus": distinct(models.Course.campus),
        "college": distinct(models.Course.college),
        "program": distinct(models.Course.program),
        "author": distinct(models.Title.author),
        "publisher": distinct(models.Title.publisher),
        "year": distinct(models.Title.year),
    }


@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db)) -> dict:
    n_courses = db.query(models.Course).count()
    n_titles = db.query(models.Title).count()
    n_matches = db.query(models.Match).count()
    matched_titles = db.query(models.Match.title_id).distinct().count()

    pub_rows = (
        db.query(models.Title.publisher)
        .join(models.Match, models.Match.title_id == models.Title.id)
        .all()
    )
    pub_counts = Counter([p[0] for p in pub_rows if p[0]]).most_common(10)

    # Titles matched across multiple programs.
    rows = (
        db.query(models.Title.id, models.Title.title, models.Course.program)
        .join(models.Match, models.Match.title_id == models.Title.id)
        .join(models.Course, models.Match.course_id == models.Course.id)
        .all()
    )
    title_programs: dict[int, set[str]] = defaultdict(set)
    title_names: dict[int, str] = {}
    for tid, name, program in rows:
        title_programs[tid].add(program or "")
        title_names[tid] = name
    cross = sorted(
        ({"title": title_names[t], "programs": len(p)} for t, p in title_programs.items() if len(p) > 1),
        key=lambda r: -r["programs"],
    )[:10]

    return {
        "totals": {
            "courses": n_courses,
            "titles": n_titles,
            "matches": n_matches,
            "matched_titles": matched_titles,
        },
        "top_publishers": [{"publisher": p, "count": c} for p, c in pub_counts],
        "cross_program_titles": cross,
    }


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------
@app.get("/api/export")
def export(
    fmt: str = Query("xlsx", pattern="^(xlsx|csv|pdf|docx)$"),
    campus: Optional[str] = None,
    college: Optional[str] = None,
    program: Optional[str] = None,
    course: Optional[str] = None,
    author: Optional[str] = None,
    publisher: Optional[str] = None,
    year: Optional[str] = None,
    db: Session = Depends(get_db),
):
    data = recommendations(campus, college, program, course, author, publisher, year, "apa7", db)
    rows = data["rows"]
    if fmt == "xlsx":
        content = exports.to_xlsx(rows)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        name = "recommendations.xlsx"
    elif fmt == "csv":
        content = exports.to_csv(rows)
        media = "text/csv"
        name = "recommendations.csv"
    elif fmt == "pdf":
        content = exports.to_pdf(rows)
        media = "application/pdf"
        name = "recommendations.pdf"
    else:
        content = exports.to_docx(rows)
        media = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        name = "recommendations.docx"
    return Response(
        content=content,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------
@app.post("/api/admin/reset")
def reset(db: Session = Depends(get_db)) -> dict:
    db.query(models.Match).delete()
    db.query(models.Title).delete()
    db.query(models.Course).delete()
    db.commit()
    seed_programs()
    return {"ok": True}


@app.post("/api/admin/reseed")
def reseed() -> dict:
    n = seed_programs()
    return {"inserted": n}
