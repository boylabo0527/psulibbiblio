-- Migration: two new title formats -- ebook_complementary and
-- journal_complementary, for digital titles that come bundled free
-- alongside a paid subscription (a platform's package deal) rather than
-- being individually paid for or genuinely open access. Also adds a
-- "provider" column (e.g. "Perlego") for paid eBooks/journals, so it's on
-- record which platform a subscription actually runs through.

alter table titles drop constraint if exists titles_format_check;

alter table titles add constraint titles_format_check check (format in (
  'ebook_paid', 'ebook_open', 'ebook_complementary',
  'book_printed',
  'journal_printed',
  'journal_online_paid', 'journal_online_open', 'journal_complementary',
  'institutional_repository'
));

alter table titles add column if not exists provider text default '';
