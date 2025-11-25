-- 011_index_hardening.sql
-- Targeted index hardening for Slack + dashboards + workers

-- 1) Manager-centric cohort queries
--    Pattern: "show me all ACTIVE reports for this manager"
CREATE INDEX IF NOT EXISTS idx_employees_manager_status
    ON employees (manager_employee_id, employment_status);

-- 2) Latest event per employee (Slack, workers, double-punch guard)
--    Pattern: "what was the last event for this employee?"
CREATE INDEX IF NOT EXISTS idx_attendance_employee_ts
    ON attendance_events (employee_id, event_timestamp_utc DESC);
