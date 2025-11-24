-- 009_attendance_immutability_and_double_punch_guard.sql
-- Protect the attendance_events ledger

CREATE OR REPLACE FUNCTION attendance_events_guard_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    last_evt attendance_events;
BEGIN
    -- 1. Immutability enforcement
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        RAISE EXCEPTION
            'attendance_events is immutable; % not allowed', TG_OP
            USING ERRCODE = '55000';
    END IF;

    -- 2. Double-punch prevention (only on INSERT)
    IF TG_OP = 'INSERT' THEN
        SELECT *
        INTO last_evt
        FROM attendance_events
        WHERE employee_id = NEW.employee_id
        ORDER BY event_timestamp_utc DESC
        LIMIT 1;

        IF last_evt.id IS NOT NULL
           AND last_evt.event_type = NEW.event_type
           AND last_evt.business_date_ist = NEW.business_date_ist
        THEN
            RAISE EXCEPTION
                'Double punch detected for employee %, event %',
                NEW.employee_id, NEW.event_type
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Attach trigger (single trigger handling INSERT/UPDATE/DELETE)
DROP TRIGGER IF EXISTS attendance_events_guard_trg ON attendance_events;

CREATE TRIGGER attendance_events_guard_trg
BEFORE INSERT OR UPDATE OR DELETE ON attendance_events
FOR EACH ROW
EXECUTE FUNCTION attendance_events_guard_fn();
