-- 007_create_attendance_enums.sql

-- attendance_event_type
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'attendance_event_type'
    ) THEN
        CREATE TYPE attendance_event_type AS ENUM (
            'CLOCK_IN',
            'CLOCK_OUT',
            'BREAK_START',
            'BREAK_END',
            'AUTO_ADJUST',
            'ADMIN_ADJUST'
        );
    END IF;
END
$$;

-- attendance_sync_status
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'attendance_sync_status'
    ) THEN
        CREATE TYPE attendance_sync_status AS ENUM (
            'PENDING',
            'SUCCESS',
            'FAILED',
            'PERMANENT_FAILURE',
            'SKIPPED'
        );
    END IF;
END
$$;

-- attendance_daily_status
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'attendance_daily_status'
    ) THEN
        CREATE TYPE attendance_daily_status AS ENUM (
            'OFF_DUTY',
            'ON_SHIFT',
            'ON_BREAK',
            'ERROR'
        );
    END IF;
END
$$;
