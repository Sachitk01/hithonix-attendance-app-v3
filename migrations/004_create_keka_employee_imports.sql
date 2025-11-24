-- 004_create_keka_employee_imports.sql
-- Staging area for raw Keka employee payloads (latest snapshot per employee)

CREATE TABLE keka_employee_imports (
    keka_employee_id TEXT PRIMARY KEY,
    raw_payload      JSONB NOT NULL,
    fetched_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
