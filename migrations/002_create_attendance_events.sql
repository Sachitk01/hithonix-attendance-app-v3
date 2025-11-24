-- 002_create_attendance_events.sql
-- Immutable attendance ledger

CREATE TABLE attendance_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    employee_id UUID NOT NULL REFERENCES employees(id),

    event_type event_type_enum NOT NULL,
    source TEXT NOT NULL DEFAULT 'SLACK',

    event_timestamp_utc TIMESTAMPTZ NOT NULL,
    event_timestamp_ist TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    business_date_ist DATE NOT NULL,

    sync_status sync_status_enum NOT NULL DEFAULT 'PENDING',

    keka_request_body JSONB,
    keka_response_body JSONB,
    keka_status_code INT,
    attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_attempt_at TIMESTAMPTZ,

    meta JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Core access patterns

-- Employee + business date
CREATE INDEX idx_attendance_employee_date
    ON attendance_events(employee_id, business_date_ist);

-- Sync workers by status + date
CREATE INDEX idx_attendance_sync_date
    ON attendance_events(sync_status, business_date_ist);

-- Latest events per employee
CREATE INDEX idx_attendance_employee_timestamp
    ON attendance_events(employee_id, event_timestamp_utc DESC);
