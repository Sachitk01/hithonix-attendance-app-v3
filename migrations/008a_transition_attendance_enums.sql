-- 008a_transition_attendance_enums.sql
-- Transitional cast via TEXT for legacy enum replacement

-- Step 1: Convert event_type_enum → TEXT
ALTER TABLE attendance_events
    ALTER COLUMN event_type TYPE TEXT
    USING event_type::text;

-- Step 2: Convert sync_status_enum → TEXT
ALTER TABLE attendance_events
    ALTER COLUMN sync_status TYPE TEXT
    USING sync_status::text;

-- Step 3: Convert daily_status_enum → TEXT
ALTER TABLE daily_status
    ALTER COLUMN current_status TYPE TEXT
    USING current_status::text;
