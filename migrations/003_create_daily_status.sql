-- 003_create_daily_status.sql
-- Fast UI projection: one row per employee per IST business date

CREATE TABLE daily_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    employee_id UUID NOT NULL REFERENCES employees(id),
    business_date_ist DATE NOT NULL,

    current_status daily_status_enum NOT NULL DEFAULT 'OFF_DUTY',

    last_event_id UUID REFERENCES attendance_events(id),
    last_event_timestamp_utc TIMESTAMPTZ,

    break_minutes_used INT NOT NULL DEFAULT 0 CHECK (break_minutes_used >= 0),
    has_sync_errors BOOLEAN NOT NULL DEFAULT FALSE,

    notes JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (employee_id, business_date_ist)
);

CREATE INDEX idx_daily_status_date
    ON daily_status(business_date_ist);

CREATE INDEX idx_daily_status_employee_date
    ON daily_status(employee_id, business_date_ist);
