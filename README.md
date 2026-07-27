# PSU Bibliography Generator

Per-program subject bibliographies for the PSU library. Each program's
output mirrors the **BA_PolSci_100725** template:

- **`sum` sheet** — summary of professional books, with per-subject
  *Printed Titles · Volumes · eBook Titles · Total Titles · Total Volumes*
  and program totals.
- **`Detail` sheet** — per subject: course code, course title, the
  course description, then the `Call No. | Author | Title | Year | Copy`
  table with `eBooks (Kavita)` and `Printed Books` blocks, ending in
  *Titles* / *Volumes* counts.

**Stack:** Next.js 14 (App Router) on Vercel · Supabase Postgres · pure
TypeScript TF-IDF matcher · no external AI keys.

## What it does

1. Upload three things per program:
   - **Subjects** — a spreadsheet with one row per subject (program,
     section, course code, course title, description).
   - **Perlego title list** — marked as eBooks (Kavita).
   - **Printed books catalog** — Call No., Author, Title, Year, Copies.
2. **Match** — TF-IDF + cosine assigns the top-K books to each subject
   from the description. Manual additions and removals are preserved
   across reruns.
3. **Edit** — in the *Programs* tab, pick a program, review subjects,
   add or remove books per subject.
4. **Export** — the program's bibliography as XLSX (template-shaped),
   CSV, PDF, or DOCX.

## Setup

### 1. Supabase

1. Create a project at <https://supabase.com>.
2. SQL editor → run **[supabase/schema.sql](supabase/schema.sql)**.
3. Project Settings → API → copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY`
4. Pick an admin password and set `ADMIN_RESET_PASSWORD` (any string you
   choose). The Admin → *Wipe all data* button prompts for this. If it
   is unset the wipe endpoint returns 503 and refuses to delete anything.

### 2. Run locally

```bash
cp .env.example .env.local   # paste the three keys
npm install
npm run dev                   # → http://localhost:3000
```

### 3. Deploy to Vercel

1. Push this repo to GitHub.
2. Vercel → New Project → import the repo.
3. Set the three env vars in Project Settings → Environment Variables.
4. Deploy. `vercel.json` already raises function timeouts for the match
   and upload routes.

## Subject-file format

The subjects upload accepts xlsx / xls / csv. Recognized columns
(case-insensitive, header aliasing built in):

| Canonical | Aliases |
|-|-|
| `program` | program, programme, program / degree, degree |
| `campus` | campus |
| `college` | college, school, faculty |
| `section` | section, category, course type |
| `course code` | course code, code, subject code |
| `course title` | course title, course, title, subject title |
| `description` | description, course description, syllabus, synopsis |

If your file has no program column, set the **Program override** field
in the upload card (also Campus / College overrides) and the whole file
is attributed to that program.

## Printed-books format

xlsx / xls / csv with recognized columns: Call No., Author, Title, Year,
Copies, Publisher, ISBN.

## Project layout

```
app/
  page.tsx                    4-tab UI shell
  layout.tsx, globals.css
  api/
    upload/
      subjects/route.ts       parse subject list, create/find programs
      titles/route.ts         insert Perlego eBooks
      printed/route.ts        insert printed catalog rows
    match/
      run/route.ts            TF-IDF matching → assignments
      override/route.ts       pin / remove a single assignment
    programs/route.ts         list programs
    programs/[id]/bibliography/route.ts  joined bibliography for a program
    titles/search/route.ts    title search for the "Add book" UI
    export/route.ts           xlsx | csv | pdf | docx for a program
    dashboard/route.ts        totals (programs, subjects, titles, ...)
    admin/reset/route.ts      wipe all rows
    health/route.ts
components/
  UploadTab.tsx, MatchTab.tsx, ProgramsTab.tsx, DashboardTab.tsx
lib/
  supabase.ts            service-role + anon clients
  parsers.ts             parseEbookTitles / parsePrintedBooks / parseSubjects
  matcher.ts             TF-IDF + cosine matcher (subjects × titles)
  bibliography.ts        joined program + subjects + assignments → tree
  exports.ts             template-shaped xlsx, csv, pdf, docx
  types.ts
supabase/schema.sql      programs, subjects, titles, assignments + RLS
data/
  psu_programs.csv             PSU campus/college/program catalog (reference)
  sample_perlego_titles.xls    sample Perlego ebook list
  sample_BA_PolSci.xlsx        target output template
```

## Scope notes

This is an MVP. Out of scope for this pass: role-based auth, multi-tenant
project save/load, per-title edition tracking, audit log beyond match
explanations, semantic-embedding matching. The data model and routes are
structured to add any of those without rework.
