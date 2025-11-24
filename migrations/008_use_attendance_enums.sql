-- 008_use_attendance_enums.sql
-- Convert TEXT columns to the new attendance enums

-- attendance_events.event_type -> attendance_event_type
ALTER TABLE attendance_events
    ALTER COLUMN event_type TYPE attendance_event_type
    USING event_type::attendance_event_type;

-- attendance_events.sync_status -> attendance_sync_status
ALTER TABLE attendance_events
    ALTER COLUMN sync_status TYPE attendance_sync_status
    USING sync_status::attendance_sync_status;

-- daily_status.current_status -> attendance_daily_status
ALTER TABLE daily_status
    ALTER COLUMN current_status TYPE attendance_daily_status
    USING current_status::attendance_daily_status;
