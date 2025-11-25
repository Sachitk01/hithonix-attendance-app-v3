-- Migration: 018_worker_privileges.sql
-- Grant limited UPDATE privileges to worker role for sync-related columns
BEGIN;

-- Ensure role exists (create if not exists is not supported; we attempt a safe grant)
-- NOTE: Replace 'hithonix_worker' with the actual worker DB role if different.
GRANT SELECT ON attendance_events TO hithonix_worker;
GRANT UPDATE (sync_status, keka_request_body, keka_response_body, attempt_count, last_attempt_at) ON attendance_events TO hithonix_worker;
GRANT INSERT ON audit_logs TO hithonix_worker;

COMMIT;

-- IMPORTANT: This migration assumes the role 'hithonix_worker' exists. Create the role beforehand if needed:
-- CREATE ROLE hithonix_worker LOGIN PASSWORD 'secure_password';
