-- 010_create_audit_logs.sql
-- Central audit trail for admin / override actions

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Who is performing the action (Slack user id)
    actor_slack_id TEXT NOT NULL,

    -- Which employee is affected
    target_employee_id UUID REFERENCES employees(id),

    -- What kind of action is this (e.g. UNLOCK_DAY, ADMIN_ADJUST)
    action TEXT NOT NULL,

    -- Optional free-text reason
    reason TEXT,

    -- Optional structured context (before/after, request ids, etc.)
    context JSONB,

    -- When this audit record was created
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- For quickly seeing actions on a specific employee
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_date
    ON audit_logs (target_employee_id, created_at DESC);

-- For quickly seeing what a given admin has been doing
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_date
    ON audit_logs (actor_slack_id, created_at DESC);
