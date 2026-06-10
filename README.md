# PSU Bibliography Generator

Web app that turns a Perlego title list + course descriptions into a
matched bibliography and library acquisition table.

This MVP runs entirely locally: a FastAPI backend with SQLite, a static
HTML/JS frontend, and a TF-IDF + cosine-similarity matcher. No external
API keys required.

## Features

- Upload Perlego title lists (`.xlsx`, `.xls`, `.csv`, `.pdf`, `.docx`).
- Upload course descriptions in the same formats.
- PSU campus/college/program catalog is seeded automatically on first run
  from `data/psu_programs.csv`.
- TF-IDF + cosine similarity matches each course to the most relevant
  titles, with shared-term explainability.
- Bibliography output in APA 7, MLA 9, Chicago (author-date), and Harvard.
- Master recommendation table sorted by Campus → College → Program →
  Course → Book Title.
- Aggregated copy-count heuristic (number of matching courses + an
  enrollment factor when provided).
- Filter by campus, college, program, course, author, publisher, year.
- Export the master table to XLSX, CSV, PDF, DOCX.
- Dashboard: totals, top publishers, titles spanning multiple programs.
- Manual override endpoint (`POST /api/match/override`) to pin or
  remove individual course/title pairs.

## Quick start

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Open <http://localhost:8000>.

1. Upload a Perlego title list on the **Upload** tab.
2. (Optional) Upload course descriptions — PSU programs are already
   seeded from `data/psu_programs.csv`.
3. Run **Matching**.
4. Browse, filter, and export the resulting recommendation table.

## File layout

```
app/
  main.py        FastAPI app, routes, uploads, matching, export
  db.py          SQLite engine
  models.py      Title, Course, Match ORM models
  schemas.py     Pydantic DTOs
  parsers.py     Title + course parsing across formats
  matcher.py     TF-IDF cosine match + copy-count heuristic
  citations.py   APA7 / MLA9 / Chicago / Harvard
  exports.py     XLSX / CSV / PDF / DOCX export
  seed.py        Seed PSU campus/college/program rows
data/
  psu_programs.csv          PSU catalog (used for seeding)
  sample_perlego_titles.xls Sample Perlego title list
static/
  index.html, app.js, styles.css
```

## Recognized columns

The parser auto-detects common column names:

- **Titles:** `publication_title`/`title`, `first_author`/`author`,
  `publisher_name`/`publisher`, `year`, `online_identifier`/`isbn`,
  `title_url`/`url`, optional `subjects`.
- **Courses:** `campus`, `college`, `program`, `major`, `course code`,
  `course title`, `description`, `learning outcomes`, `keywords`,
  `enrollment`.

## Scope notes

This is an MVP. Out of scope for this pass: role-based authentication,
multi-tenant project save/load, PostgreSQL, audit logging beyond match
explanations, full Next.js/Tailwind UI. The backend is structured so any
of those can be added without reworking the data model.
