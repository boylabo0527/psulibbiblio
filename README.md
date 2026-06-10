# PSU Bibliography Generator

Web app that turns a Perlego title list + course descriptions into a
matched bibliography and a sortable library acquisition table.

**Stack:** Next.js 14 (App Router) on Vercel · Supabase Postgres for data ·
TypeScript TF-IDF + cosine matcher · no external AI keys required.

## What it does

- Upload Perlego title lists (`.xlsx`, `.xls`, `.csv`, `.pdf`, `.docx`)
  and course description files in the same formats.
- Seeds the PSU campus/college/program catalog from
  `data/psu_programs.csv`.
- Runs TF-IDF + cosine matching locally inside a serverless function
  (no per-row API calls), with shared-term explanations.
- Bibliographies in APA 7, MLA 9, Chicago (author-date), Harvard.
- Master recommendation table sorted by Campus → College → Program →
  Course → Book Title, with aggregated copy counts (number of matching
  courses + an enrollment factor).
- Filters by campus / college / program / course / author / publisher /
  year.
- Exports to XLSX, CSV, PDF, DOCX.
- Dashboard: totals, top publishers, titles spanning multiple programs.

## Setup

### 1. Create a Supabase project

1. <https://supabase.com> → New project.
2. Open the SQL editor and run **[supabase/schema.sql](supabase/schema.sql)**.
3. From **Project Settings → API** copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only)

### 2. Run locally

```bash
cp .env.example .env.local   # then paste the three keys
npm install
npm run dev
```

Open <http://localhost:3000>. On the Upload tab, click **Seed programs**
to load the PSU catalog, then upload a Perlego title list, then go to
the Match tab and click **Run matching**.

Or seed the catalog from the command line:

```bash
npm run seed
```

### 3. Deploy to Vercel

1. Push this repo to GitHub.
2. <https://vercel.com> → New Project → import the repo.
3. Set the three env vars in **Project Settings → Environment Variables**.
4. Deploy. `vercel.json` already extends the match/upload/export
   function timeouts.

## Project layout

```
app/
  page.tsx              4-tab UI shell
  layout.tsx, globals.css
  api/
    upload/titles/route.ts       parse & insert Perlego titles
    upload/courses/route.ts      parse & insert course descriptions
    match/run/route.ts           TF-IDF + cosine matching
    match/override/route.ts      manual override / pin / remove
    recommendations/route.ts     filtered master table + bibliography
    facets/route.ts              distinct values for filter dropdowns
    dashboard/route.ts           totals, top publishers, cross-program titles
    export/route.ts              xlsx | csv | pdf | docx
    admin/seed/route.ts          insert PSU programs from data/psu_programs.csv
    admin/reset/route.ts         wipe all tables
    health/route.ts
components/
  UploadTab.tsx, MatchTab.tsx, BrowseTab.tsx, DashboardTab.tsx
lib/
  supabase.ts           service-role + anon clients
  parsers.ts            xlsx/xls/csv/pdf/docx parsing with header aliasing
  matcher.ts            TF-IDF + cosine in pure TS
  citations.ts          APA 7 / MLA 9 / Chicago / Harvard
  exports.ts            xlsx (ExcelJS) / csv / pdf (pdfkit) / docx
  recommendations.ts    join + aggregate + format
  types.ts
supabase/schema.sql     Postgres schema, indexes, basic RLS
scripts/seed.ts         CLI seeder for data/psu_programs.csv
data/                   psu_programs.csv (seed), sample_perlego_titles.xls
```

## Recognized columns

The parser auto-detects common header variants:

- **Titles:** `publication_title`/`title`, `first_author`/`author`,
  `publisher_name`/`publisher`, `year`, `online_identifier`/`isbn`,
  `title_url`/`url`, optional `subjects`.
- **Courses:** `campus`, `college`, `program`, `major`, `course code`,
  `course title`, `description`, `learning outcomes`, `keywords`,
  `enrollment`.

## Scope notes

This is an MVP. Out of scope for this pass: role-based auth, multi-tenant
project save/load, audit logging beyond match explanations, manual
override UI (the endpoint exists but no UI yet), semantic embeddings.
The data model and routes are structured so any of those can be added
without rework.
