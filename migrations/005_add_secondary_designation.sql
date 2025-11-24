-- 005_add_secondary_designation.sql
-- Optional secondary job title from Keka

ALTER TABLE employees
ADD COLUMN secondary_designation TEXT;
