-- Market Canvassing gains a `validated` flag, separate from just having a
-- subject_id assigned. Until now, any canvassing row with a course
-- assigned (whether confirmed by a librarian or just the auto-suggested
-- best guess from CanvassingTab's relevanceScore heuristic) was
-- immediately treated as "ready for Purchase Request" by PurchaseRequestTab
-- -- there was no review gate before a proposal fed into a real purchase
-- document. `validated` is that gate: PurchaseRequestTab now only pulls in
-- rows that are both assigned AND validated (see app/api/canvassing/
-- mass-validate and mass-unassign for how it's set/cleared).
alter table canvassing add column if not exists validated boolean not null default false;
