ALTER TABLE attendance_events
    ALTER COLUMN sync_status DROP DEFAULT;

ALTER TABLE daily_status
    ALTER COLUMN current_status DROP DEFAULT;
