-- Migration: per-campus budget tracking, so Monitoring can show spend vs.
-- allocation per campus and flag which campuses are over/under -- the
-- informational basis for a human decision to have one campus contribute
-- excess budget to another. No transfer/movement of funds is modeled here
-- (that stays a manual/offline decision for now); this table only holds
-- what an admin says each campus's allocation is for a period. "Spent" is
-- not stored here -- it's computed on read by summing
-- purchase_requests.total_amount for that campus/period, so it's always
-- current with actual generated PRs.

create table if not exists campus_budgets (
  id bigserial primary key,
  campus_id bigint not null references campuses(id) on delete cascade,
  period text not null,  -- e.g. "2026" (fiscal year) -- free text so a school/half-year period works too
  amount numeric not null default 0,
  updated_at timestamptz default now(),
  updated_by text default ''
);
create unique index if not exists campus_budgets_unique on campus_budgets(campus_id, period);

alter table campus_budgets enable row level security;
