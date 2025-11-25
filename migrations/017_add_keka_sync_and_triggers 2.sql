-- Migration: 017_add_keka_sync_and_triggers.sql
-- Adds enums, attendance_events ledger, daily_status, audit_logs, keka_tokens,
-- and trigger/functions for immutability checks and projection into daily_status.
-- Compatible with Postgres 16. Use in staging first. Create indexes CONCURRENTLY on large tables.

BEGIN;

-- 1) Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_event_type') THEN
    CREATE TYPE attendance_event_type AS ENUM (
      'CLOCK_IN',
      'CLOCK_OUT',
      'BREAK_START',
      'BREAK_END',
      'LUNCH_START',
      'LUNCH_END',
      'ADMIN_ADJUST',
      'AUTO_ADJUST',
      'SYSTEM_NOTE'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_sync_status') THEN
    CREATE TYPE attendance_sync_status AS ENUM (
      'PENDING',
      'PROCESSING',
      'SUCCESS',
      'FAILED',
      'PERMANENT_FAILURE',
      'SKIPPED'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_daily_status') THEN
    CREATE TYPE attendance_daily_status AS ENUM (
      'OFF_DUTY',
      'ON_SHIFT',
      'ON_BREAK',
      'ON_LUNCH'
    );
  END IF;
END$$;

-- 2) attendance_events ledger (append-only)
CREATE TABLE IF NOT EXISTS attendance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  event_type attendance_event_type NOT NULL,
  event_timestamp_utc TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- store IST timestamp as a computed column (timezone conversion stored as TIMESTAMP w/o tz)
  event_timestamp_ist TIMESTAMP WITHOUT TIME ZONE GENERATED ALWAYS AS ((event_timestamp_utc AT TIME ZONE 'Asia/Kolkata')) STORED,
  business_date_ist DATE NOT NULL,
  payload JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Keka sync metadata (worker-updatable columns)
  sync_status attendance_sync_status NOT NULL DEFAULT 'PENDING',
  keka_request_body JSONB,
  keka_response_body JSONB,
  attempt_count INT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,

  created_by_slack_id TEXT NULL
);

ALTER TABLE attendance_events
  ADD CONSTRAINT IF NOT EXISTS attendance_events_business_date_ist_check
    CHECK ( business_date_ist = (event_timestamp_utc AT TIME ZONE 'Asia/Kolkata')::date );

-- Indexes used by worker and read models. For large tables create CONCURRENTLY if needed.
CREATE INDEX IF NOT EXISTS idx_attendance_events_employee_date ON attendance_events (employee_id, business_date_ist);
CREATE INDEX IF NOT EXISTS idx_attendance_events_sync_status_date ON attendance_events (sync_status, business_date_ist);
CREATE INDEX IF NOT EXISTS idx_attendance_events_created_at ON attendance_events (created_at);

-- 3) daily_status (derived, one row per employee per IST date)
CREATE TABLE IF NOT EXISTS daily_status (
  id BIGSERIAL PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  business_date_ist DATE NOT NULL,
  current_status attendance_daily_status NOT NULL DEFAULT 'OFF_DUTY',
  last_event_id UUID NULL REFERENCES attendance_events (id) ON DELETE SET NULL,
  last_event_timestamp_utc TIMESTAMPTZ NULL,
  break_minutes_used INT NOT NULL DEFAULT 0,
  has_sync_errors BOOLEAN NOT NULL DEFAULT FALSE,
  notes JSONB NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, business_date_ist)
);

CREATE INDEX IF NOT EXISTS idx_daily_status_employee_date ON daily_status (employee_id, business_date_ist);
CREATE INDEX IF NOT EXISTS idx_daily_status_business_date ON daily_status (business_date_ist);

-- 4) audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_slack_id TEXT NOT NULL,
  target_employee_id UUID NULL REFERENCES employees(id),
  action TEXT NOT NULL,
  reason TEXT,
  context JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs (target_employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor_slack_id, created_at DESC);

-- 5) keka_tokens (simple cache for access token)
CREATE TABLE IF NOT EXISTS keka_tokens (
  id BIGSERIAL PRIMARY KEY,
  access_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6) BEFORE INSERT trigger: enforce business_date consistency & simple double-punch guards
CREATE OR REPLACE FUNCTION attendance_events_before_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  existing_count INT;
BEGIN
  -- If caller didn't set business_date_ist, derive it
  IF NEW.business_date_ist IS NULL THEN
    NEW.business_date_ist := (NEW.event_timestamp_utc AT TIME ZONE 'Asia/Kolkata')::date;
  END IF;

  IF NEW.business_date_ist <> (NEW.event_timestamp_utc AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'business_date_ist does not match event_timestamp_utc in IST for employee %', NEW.employee_id;
  END IF;

  -- Simple double-punch guard: prevent second CLOCK_IN on same day
  IF NEW.event_type = 'CLOCK_IN' THEN
    SELECT COUNT(1) INTO existing_count
    FROM attendance_events ae
    WHERE ae.employee_id = NEW.employee_id
      AND ae.business_date_ist = NEW.business_date_ist
      AND ae.event_type = 'CLOCK_IN';
    IF existing_count > 0 THEN
      RAISE EXCEPTION 'Double CLOCK_IN detected for employee % on %', NEW.employee_id, NEW.business_date_ist;
    END IF;
  END IF;

  -- Prevent BREAK_START without prior BREAK_END (simple check)
  IF NEW.event_type = 'BREAK_START' THEN
    SELECT COUNT(1) INTO existing_count
    FROM attendance_events ae
    WHERE ae.employee_id = NEW.employee_id
      AND ae.business_date_ist = NEW.business_date_ist
      AND ae.event_type = 'BREAK_START'
      AND NOT EXISTS (
        SELECT 1 FROM attendance_events ae2
        WHERE ae2.employee_id = ae.employee_id
          AND ae2.business_date_ist = ae.business_date_ist
          AND ae2.event_type = 'BREAK_END'
          AND ae2.event_timestamp_utc > ae.event_timestamp_utc
      );
    IF existing_count > 0 THEN
      RAISE EXCEPTION 'Previous BREAK_START without BREAK_END exists for employee % on %', NEW.employee_id, NEW.business_date_ist;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_events_before_insert ON attendance_events;
CREATE TRIGGER trg_attendance_events_before_insert
BEFORE INSERT ON attendance_events
FOR EACH ROW EXECUTE FUNCTION attendance_events_before_insert();

-- 7) AFTER INSERT trigger: project state into daily_status and compute break minutes
CREATE OR REPLACE FUNCTION attendance_events_after_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  new_status attendance_daily_status;
  break_minutes INT;
  last_event_uuid UUID;
BEGIN
  IF (NEW.event_type = 'CLOCK_IN') THEN
    new_status := 'ON_SHIFT';
  ELSIF (NEW.event_type = 'CLOCK_OUT') THEN
    new_status := 'OFF_DUTY';
  ELSIF (NEW.event_type = 'BREAK_START') THEN
    new_status := 'ON_BREAK';
  ELSIF (NEW.event_type = 'BREAK_END') THEN
    new_status := 'ON_SHIFT';
  ELSIF (NEW.event_type = 'LUNCH_START') THEN
    new_status := 'ON_LUNCH';
  ELSIF (NEW.event_type = 'LUNCH_END') THEN
    new_status := 'ON_SHIFT';
  ELSE
    new_status := 'OFF_DUTY';
  END IF;

  -- compute break minutes by pairing BREAK_START / BREAK_END for the day
  SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (ae_end.event_timestamp_utc - ae_start.event_timestamp_utc))/60)::INT, 0)
  INTO break_minutes
  FROM attendance_events ae_start
  JOIN attendance_events ae_end
    ON ae_end.employee_id = ae_start.employee_id
   AND ae_end.business_date_ist = ae_start.business_date_ist
   AND ae_end.event_type = 'BREAK_END'
   AND ae_start.event_type = 'BREAK_START'
   AND ae_end.event_timestamp_utc > ae_start.event_timestamp_utc
  WHERE ae_start.employee_id = NEW.employee_id
    AND ae_start.business_date_ist = NEW.business_date_ist;

  last_event_uuid := NEW.id;

  INSERT INTO daily_status (employee_id, business_date_ist, current_status, last_event_id, last_event_timestamp_utc, break_minutes_used, has_sync_errors, updated_at)
  VALUES (NEW.employee_id, NEW.business_date_ist, new_status, last_event_uuid, NEW.event_timestamp_utc, break_minutes, (NEW.sync_status <> 'SUCCESS')::boolean, now())
  ON CONFLICT (employee_id, business_date_ist) DO UPDATE
  SET current_status = EXCLUDED.current_status,
      last_event_id = EXCLUDED.last_event_id,
      last_event_timestamp_utc = EXCLUDED.last_event_timestamp_utc,
      break_minutes_used = EXCLUDED.break_minutes_used,
      has_sync_errors = EXCLUDED.has_sync_errors,
      updated_at = now();

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_events_after_insert ON attendance_events;
CREATE TRIGGER trg_attendance_events_after_insert
AFTER INSERT ON attendance_events
FOR EACH ROW EXECUTE FUNCTION attendance_events_after_insert();

COMMIT;

-- Notes:
-- 1) For very large tables, create indexes using CREATE INDEX CONCURRENTLY to avoid locks.
-- 2) This migration is additive and safe to run on staging first.
-- 3) Backfill scripts should be run separately for existing rows with NULL/mismatched business_date_ist.
