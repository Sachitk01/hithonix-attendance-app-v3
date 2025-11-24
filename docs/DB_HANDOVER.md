# Database Handover — Hithonix v2.0

This document explains how to operate, validate, and maintain the Hithonix v2.0 database artifacts produced during handover.
It is written for the backend team and SREs taking over the DB work. Follow steps in order and run in staging first.

1) Overview
- Core model: Immutable ledger (`attendance_events`) + derived whiteboard (`daily_status`).
- Core tables: `employees`, `attendance_events`, `daily_status`, `audit_logs`, `keka_employee_imports`, `keka_tokens`.
- Key invariants: attendance_events is append-only; daily_status is derived by DB triggers; all admin actions are auditable.

2) Files added in this handover
- migrations/017_add_keka_sync_and_triggers.sql — enums, attendance_events ledger, triggers, daily_status, audit_logs, keka_tokens.
- migrations/018_worker_privileges.sql — grants worker role limited UPDATE access for sync fields.
- backend/scripts/backfill_business_date.js — safe scanner and optional apply (with --apply) to correct business_date_ist mismatches; writes `audit_logs` entries for each change.
- backend/scripts/report_data_anomalies.js — generates anomalies report (duplicate CLOCK_IN, unclosed BREAK_START, lunch mismatches).

3) Pre-flight checks (staging)
- Ensure you have a recent DB backup before running any repairs.
- Confirm `DATABASE_URL` points to staging.
- Run migrations in staging using your usual migration tool (e.g., node-pg-migrate or sql-migrate). Example:

```bash
# from repo root
psql "$DATABASE_URL" -f migrations/017_add_keka_sync_and_triggers.sql
psql "$DATABASE_URL" -f migrations/018_worker_privileges.sql
```

4) Index considerations
- For very large `attendance_events`, create indexes using `CREATE INDEX CONCURRENTLY` to avoid exclusive locks. Example (manual):

```sql
CREATE INDEX CONCURRENTLY idx_attendance_events_employee_date ON attendance_events (employee_id, business_date_ist);
CREATE INDEX CONCURRENTLY idx_attendance_events_sync_status_date ON attendance_events (sync_status, business_date_ist);
```

Run these in maintenance windows if table is large.

5) Running repair & reporting scripts
- Report anomalies:

```bash
DATABASE_URL="postgres://..." node backend/scripts/report_data_anomalies.js --out=reports/anomalies.json
```

- Review `reports/anomalies.json`. If the report looks sensible, consider corrective actions.

- Backfill `business_date_ist` (DRY RUN first):

```bash
DATABASE_URL="postgres://..." node backend/scripts/backfill_business_date.js --limit=100
```

- To actually apply fixes (only after approval and backup):

```bash
DATABASE_URL="postgres://..." node backend/scripts/backfill_business_date.js --limit=200 --apply
```

Notes: Each update writes an audit_log entry with `actor_slack_id = 'system.backfill'`. This is an exceptional, one-time repair and temporarily violates the append-only rule for attendance_events. Keep a record of runs and outputs.

6) Worker role setup
- Create the worker DB role (if not present):

```sql
CREATE ROLE hithonix_worker LOGIN PASSWORD '<strong-password>';
GRANT CONNECT ON DATABASE yourdb TO hithonix_worker;
-- run migration 018 to grant column-level privileges
```

- Ensure the worker process uses this DB role when connecting (DB connection string or pool user).

7) Deployment & rollout
- Deploy DB migrations first, then backend code (keka worker and services).
- Start worker with low concurrency (1) and monitor logs for errors and Keka responses.
- Observe sync queue and metrics for at least 1-2 days before scaling concurrency.

8) Monitoring & reconciliation
- Monitor the following:
  - `attendance_events` rows with `sync_status != 'SUCCESS'` (worker dashboard)
  - `daily_status.has_sync_errors` for spikes
  - Keka API error patterns (4xx vs 5xx) to decide permanent failure classification

- Reconciliation job (future): scan events with attempt_count > N and sync_status != 'SUCCESS', surface to admin UI.

9) Rollback guidance
- Migrations added are largely additive. If something fails:
  - For indexes: DROP INDEX CONCURRENTLY if needed.
  - For worker grants: REVOKE privileges and restart worker with different role.
  - For accidental apply of backfill: consult backups and restore (or produce compensating audit entries and admin adjustments).

10) Assumptions & risks
- Assumption: Keka ingestion API shape will be mapped by application-layer code — DB does not depend on Keka payload format.
- Risk: Updating `attendance_events` is sensitive. Use the backfill script with caution and always create audit entries (script does this).

11) Next steps (recommended)
- Implement a safe reconciliation job and admin UI for resolving sync failures.
- Add unit tests for trigger functions using pgTAP or similar.
- Consider creating a `repairs` schema to contain any corrective records if you want to avoid updating the canonical ledger in future.

Contact: Sachit (Chief Architect) for policy decisions where the ledger invariants must be relaxed.
