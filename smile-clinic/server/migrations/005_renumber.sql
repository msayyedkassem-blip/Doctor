-- Not every note about a sync is a failure.
--
-- When a record arrives carrying a file or invoice number this database has
-- already given to someone else, one of the two is moved to a free number
-- rather than dropped. Staff should still see that it happened — a file number
-- on a printed form has changed — but it must not be counted among the records
-- that could not be merged at all, or a handled clash would read as data loss.
ALTER TABLE sync_issues ADD COLUMN kind TEXT NOT NULL DEFAULT 'blocked';
