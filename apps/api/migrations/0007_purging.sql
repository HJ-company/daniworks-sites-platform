-- Set when a purge starts. Irreversible deletion holds this state first; reactivation and
-- other changes refuse a site in it. A purge interrupted midway resumes on the next attempt.
ALTER TABLE sites ADD COLUMN purging_at TEXT;
