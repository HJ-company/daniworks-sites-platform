-- M4 4-D follow-up: the person behind each version (operator name, or 스크립트), shown in the
-- console's version table next to how it was made (AI, operator, customer).
ALTER TABLE site_versions ADD COLUMN author TEXT;
