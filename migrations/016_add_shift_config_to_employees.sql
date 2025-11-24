-- 016_add_shift_config_to_employees.sql
-- Add shift_config JSONB column to employees table

ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS shift_config JSONB;

-- Optional: enforce it has a shift_type in future
-- but for now allow NULL (default GENERAL)
