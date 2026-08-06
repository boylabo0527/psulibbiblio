-- Migration: tracks the last time an overdue-PR reminder email went out
-- for a purchase request, so the daily reminder cron (see
-- /api/cron/pr-reminders) re-notifies periodically instead of emailing
-- the submitter every single day it stays overdue.
alter table purchase_requests add column if not exists last_reminder_sent_at timestamptz;
