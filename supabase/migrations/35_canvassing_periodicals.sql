-- Migration: lets Market Canvassing carry journals/periodicals alongside
-- books -- a periodical is quoted differently (a subject area and issue
-- instead of an author/publisher, and a Manila price vs a Provincial price
-- instead of one flat unit cost, since PSU as a provincial campus actually
-- pays the provincial price while Manila stays a reference figure). Book
-- rows are unaffected: item_type defaults to 'book' and the new columns
-- stay blank for them.
alter table canvassing add column if not exists item_type text not null default 'book' check (item_type in ('book', 'journal'));
alter table canvassing add column if not exists subject_area text default '';
alter table canvassing add column if not exists issue text default '';
alter table canvassing add column if not exists manila_price numeric;
alter table canvassing add column if not exists provincial_price numeric;
create index if not exists canvassing_item_type_idx on canvassing (item_type);
