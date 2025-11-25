-- 020_fix_event_timestamp_ist_generated.sql
-- Fix: event_timestamp_ist should be GENERATED ALWAYS, not just NOT NULL
-- This migration safely converts the column to a generated column

BEGIN;

-- Drop the old trigger that depends on this column (if it has any dependency)
DROP TRIGGER IF EXISTS attendance_events_guard_trg ON attendance_events;
DROP TRIGGER IF EXISTS attendance_events_daily_status_trg ON attendance_events;

-- Drop any function dependencies
DROP FUNCTION IF EXISTS attendance_events_guard_fn();
DROP FUNCTION IF EXISTS daily_status_project_event_fn();
DROP FUNCTION IF EXISTS attendance_events_before_insert();
DROP FUNCTION IF EXISTS attendance_events_after_insert();

-- Recreate the column as GENERATED
ALTER TABLE attendance_events 
  DROP COLUMN IF EXISTS event_timestamp_ist;

ALTER TABLE attendance_events
  ADD COLUMN event_timestamp_ist TIMESTAMP WITHOUT TIME ZONE GENERATED ALWAYS AS ((event_timestamp_utc AT TIME ZONE 'Asia/Kolkata')) STORED;

-- Recreate the trigger functions (from migration 017)
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

  RETURN NEW;
END;
$$;

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

DROP TRIGGER IF EXISTS trg_attendance_events_before_insert ON attendance_events;
CREATE TRIGGER trg_attendance_events_before_insert
BEFORE INSERT ON attendance_events
FOR EACH ROW EXECUTE FUNCTION attendance_events_before_insert();

DROP TRIGGER IF EXISTS trg_attendance_events_after_insert ON attendance_events;
CREATE TRIGGER trg_attendance_events_after_insert
AFTER INSERT ON attendance_events
FOR EACH ROW EXECUTE FUNCTION attendance_events_after_insert();

COMMIT;
