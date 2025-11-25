-- 013_add_lunch_and_locking.sql
-- Extend enums for lunch and add locking fields on daily_status

-- 1) Extend attendance_event_type with LUNCH_START, LUNCH_END
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'attendance_event_type'
          AND e.enumlabel = 'LUNCH_START'
    ) THEN
        ALTER TYPE attendance_event_type
            ADD VALUE 'LUNCH_START';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'attendance_event_type'
          AND e.enumlabel = 'LUNCH_END'
    ) THEN
        ALTER TYPE attendance_event_type
            ADD VALUE 'LUNCH_END';
    END IF;
END
$$;

-- 2) Extend attendance_daily_status with ON_LUNCH
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'attendance_daily_status'
          AND e.enumlabel = 'ON_LUNCH'
    ) THEN
        ALTER TYPE attendance_daily_status
            ADD VALUE 'ON_LUNCH';
    END IF;
END
$$;

-- 3) Add locking columns to daily_status
ALTER TABLE daily_status
    ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE daily_status
    ADD COLUMN IF NOT EXISTS lock_reason TEXT;
