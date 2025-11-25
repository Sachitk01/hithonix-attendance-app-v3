-- 022_add_processing_sync_status.sql
-- Add PROCESSING value to sync_status_enum used by workers
ALTER TYPE sync_status_enum ADD VALUE IF NOT EXISTS 'PROCESSING';
