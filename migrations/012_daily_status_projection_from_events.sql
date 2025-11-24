-- 012_daily_status_projection_from_events.sql
-- Project attendance_events into daily_status (per employee + day)

CREATE OR REPLACE FUNCTION daily_status_project_event_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    existing_ds daily_status;
    new_status attendance_daily_status;
BEGIN
    -- Map event_type -> daily status, for core states
    new_status :=
        CASE NEW.event_type
            WHEN 'CLOCK_IN'     THEN 'ON_SHIFT'
            WHEN 'CLOCK_OUT'    THEN 'OFF_DUTY'
            WHEN 'BREAK_START'  THEN 'ON_BREAK'
            WHEN 'BREAK_END'    THEN 'ON_SHIFT'
            ELSE NULL  -- AUTO_ADJUST / ADMIN_ADJUST: no state flip (for now)
        END;

    -- Lock the existing daily_status row (if any) for this employee + day
    SELECT *
    INTO existing_ds
    FROM daily_status
    WHERE employee_id = NEW.employee_id
      AND business_date_ist = NEW.business_date_ist
    FOR UPDATE;

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
            0,                  -- start with zero break minutes
            FALSE,              -- no sync errors by default
            NULL,               -- notes empty by default
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
            updated_at = now()
        WHERE id = existing_ds.id;
    END IF;

    RETURN NEW;
END;
$$;
