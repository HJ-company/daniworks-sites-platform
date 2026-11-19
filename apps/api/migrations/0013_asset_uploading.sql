-- An upload claims its photo's row before writing files (uploading_at); a deletion refuses while
-- an upload holds it, so files are never removed under a successful upload.
ALTER TABLE assets ADD COLUMN uploading_at TEXT;
