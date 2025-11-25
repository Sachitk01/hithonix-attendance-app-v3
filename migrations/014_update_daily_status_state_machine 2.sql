-- 014_update_daily_status_state_machine.sql
-- Extend daily_status projection with lunch handling, break/lunch wallets, and basic rules

CREATE OR REPLACE FUNCTION daily_status_project_event_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    existing_ds daily_status;
    new_status attendance_daily_status;

    break_increment_minutes INT := 0;
    new_break_total INT;

    last_break_start_ts TIMESTAMPTZ;
    lunch_start_ts TIMESTAMPTZ;
    lunch_duration_minutes INT := 0;

    new_is_locked BOOLEAN;
    new_lock_reason TEXT;
BEGIN
    -- RULE: Only one LUNCH_START per employee per business_date_ist
    IF NEW.event_type = 'LUNCH_START' THEN
        IF EXISTS (
            SELECT 1
            FROM attendance_events
            WHERE employee_id = NEW.employee_id
              AND business_date_ist = NEW.business_date_ist
              AND event_type = 'LUNCH_START'
              AND id <> NEW.id
            LIMIT 1
        ) THEN
            RAISE EXCEPTION
                'Second LUNCH_START is not allowed for employee % on %',
                NEW.employee_id, NEW.business_date_ist;
        END IF;
    END IF;

    -- Load existing daily_status row for this employee + day (if any)
    SELECT *
    INTO existing_ds
    FROM daily_status
    WHERE employee_id = NEW.employee_id
      AND business_date_ist = NEW.business_date_ist
    FOR UPDATE;

    -- Default lock state based on existing row (if any)
    IF FOUND THEN
        new_is_locked := existing_ds.is_locked;
        new_lock_reason := existing_ds.lock_reason;
    ELSE
        new_is_locked := FALSE;
        new_lock_reason := NULL;
    END IF;

    -- RULE: Cannot start BREAK while ON_LUNCH
    IF FOUND THEN
        IF existing_ds.current_status = 'ON_LUNCH'
           AND NEW.event_type = 'BREAK_START'
        THEN
            RAISE EXCEPTION
                'Cannot start BREAK while ON_LUNCH for employee % on %',
                NEW.employee_id, NEW.business_date_ist;
        END IF;
    END IF;

    -- Map event_type -> candidate daily_status
    new_status :=
        CASE NEW.event_type
            WHEN 'CLOCK_IN'     THEN 'ON_SHIFT'
            WHEN 'CLOCK_OUT'    THEN 'OFF_DUTY'
            WHEN 'BREAK_START'  THEN 'ON_BREAK'
            WHEN 'BREAK_END'    THEN 'ON_SHIFT'
            WHEN 'LUNCH_START'  THEN 'ON_LUNCH'
            WHEN 'LUNCH_END'    THEN 'ON_SHIFT'
            ELSE NULL  -- ADMIN_ADJUST, AUTO_ADJUST, etc. (no direct state flip for now)
        END;

    --------------------------------------------------------------------
    -- Break wallet: compute increment on BREAK_END
    --------------------------------------------------------------------
    IF NEW.event_type = 'BREAK_END' THEN
        SELECT event_timestamp_utc
        INTO last_break_start_ts
        FROM attendance_events
        WHERE employee_id = NEW.employee_id
          AND business_date_ist = NEW.business_date_ist
          AND event_type = 'BREAK_START'
          AND event_timestamp_utc <= NEW.event_timestamp_utc
        ORDER BY event_timestamp_utc DESC
        LIMIT 1;

        IF last_break_start_ts IS NULL THEN
            -- BREAK_END without BREAK_START -> lock the day
            new_is_locked := TRUE;
            new_lock_reason := COALESCE(new_lock_reason, 'BREAK_END_WITHOUT_START');
        ELSE
            break_increment_minutes :=
                GREATEST(
                    0,
                    FLOOR(EXTRACT(EPOCH FROM (NEW.event_timestamp_utc - last_break_start_ts)) / 60)
                )::INT;
        END IF;
    END IF;

    --------------------------------------------------------------------
    -- Lunch wallet: compute duration on LUNCH_END
    --------------------------------------------------------------------
    IF NEW.event_type = 'LUNCH_END' THEN
        SELECT event_timestamp_utc
        INTO lunch_start_ts
        FROM attendance_events
        WHERE employee_id = NEW.employee_id
          AND business_date_ist = NEW.business_date_ist
          AND event_type = 'LUNCH_START'
          AND event_timestamp_utc <= NEW.event_timestamp_utc
        ORDER BY event_timestamp_utc DESC
        LIMIT 1;

        IF lunch_start_ts IS NULL THEN
            -- LUNCH_END without LUNCH_START -> lock the day
            new_is_locked := TRUE;
            new_lock_reason := COALESCE(new_lock_reason, 'LUNCH_END_WITHOUT_START');
        ELSE
            lunch_duration_minutes :=
                GREATEST(
                    0,
                    FLOOR(EXTRACT(EPOCH FROM (NEW.event_timestamp_utc - lunch_start_ts)) / 60)
                )::INT;

            IF lunch_duration_minutes > 40 THEN
                new_is_locked := TRUE;
                new_lock_reason := COALESCE(new_lock_reason, 'LUNCH_OVERLIMIT');
            END IF;
        END IF;
    END IF;

    --------------------------------------------------------------------
    -- Apply break increment to break_minutes_used with 30-min cap
    --------------------------------------------------------------------
    IF FOUND THEN
        new_break_total := existing_ds.break_minutes_used + break_increment_minutes;
    ELSE
        new_break_total := break_increment_minutes;
    END IF;

    IF new_break_total > 30 THEN
        new_is_locked := TRUE;
        new_lock_reason := COALESCE(new_lock_reason, 'BREAK_OVERLIMIT');
    END IF;

    --------------------------------------------------------------------
    -- Insert or update daily_status projection
    --------------------------------------------------------------------
    IF NOT FOUND THEN
        -- First event for this employee on this day -> insert new daily_status row
        INSERT INTO daily_status (
            id,
            employee_id,
            business_date_ist,
            current_status,
            last_event_id,
            last_event_timestamp_utc,
            break_minutes_used,
            has_sync_errors,
            notes,
            is_locked,
            lock_reason,
            created_at,
            updated_at
        )
        VALUES (
            gen_random_uuid(),
            NEW.employee_id,
            NEW.business_date_ist,
            COALESCE(new_status, 'OFF_DUTY'),
            NEW.id,
            NEW.event_timestamp_utc,
            new_break_total,
            FALSE,              -- no sync errors by default
            NULL,               -- notes empty by default
            new_is_locked,
            new_lock_reason,
            now(),
            now()
        );
    ELSE
        -- Row already exists -> update projection
        UPDATE daily_status
        SET
            current_status = COALESCE(new_status, existing_ds.current_status),
            last_event_id = NEW.id,
            last_event_timestamp_utc = NEW.event_timestamp_utc,
            break_minutes_used = new_break_total,
            is_locked = new_is_locked,
            lock_reason = new_lock_reason,
            updated_at = now()
        WHERE id = existing_ds.id;
    END IF;

    RETURN NEW;
END;
$$;

-- Recreate the trigger to ensure it points to the updated function
DROP TRIGGER IF EXISTS attendance_events_daily_status_trg
    ON attendance_events;

CREATE TRIGGER attendance_events_daily_status_trg
AFTER INSERT ON attendance_events
FOR EACH ROW
EXECUTE FUNCTION daily_status_project_event_fn();
