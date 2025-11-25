# Handover: Backend Operational Steps (1 → Z)

This document is the engineer-facing handover with exact steps to get the backend and DB into production-ready state after the DB work completed.

1) Prepare local environment
- Ensure Node.js >=20 and npm installed.
- From repo root, install deps (you may need to add packages listed below):

```bash
npm install
# Recommended additional packages for worker and integration
npm install axios bullmq ioredis openai dotenv minimist
```

2) Migrations (staging first)
- Run the newly added migrations in order:

```bash
psql "$DATABASE_URL" -f migrations/017_add_keka_sync_and_triggers.sql
psql "$DATABASE_URL" -f migrations/018_worker_privileges.sql
```

If your `attendance_events` is large, create indexes concurrently (see `docs/DB_HANDOVER.md`).

3) Backfill & anomaly reporting (dry-run)
- Generate anomalies report:

```bash
DATABASE_URL="postgres://..." node backend/scripts/report_data_anomalies.js --out=reports/anomalies.json
```

- Review report then run backfill DRY RUN:

```bash
DATABASE_URL="postgres://..." node backend/scripts/backfill_business_date.js --limit=100
```

- If approved, apply fixes (after backup):

```bash
DATABASE_URL="postgres://..." node backend/scripts/backfill_business_date.js --limit=200 --apply
```

4) Worker setup
- Create DB role for worker if missing (example):

```sql
CREATE ROLE hithonix_worker LOGIN PASSWORD '<secure-password>';
GRANT CONNECT ON DATABASE yourdb TO hithonix_worker;
```

- Ensure the worker process uses the `hithonix_worker` DB credentials.

5) Environment variables
- The backend expects the following env vars (see `/backend/.env.example` or `/backend/.env`):
  - DATABASE_URL
  - REDIS_URL
  - KEKA_API_KEY
  - KEKA_COMPANY_ALIAS
  - KEKA_ENV_DOMAIN
  - OPENAI_API_KEY
  - SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET (for Slack)

6) Run worker locally (dev)
- Example node script (requires TypeScript build if using .ts files):

```bash
# compile TypeScript if applicable
npm run build

# start worker (example using node and ts-node or compiled JS)
node dist/queues/kekaSync.worker.js
```

7) Enqueue semantics
- The application must enqueue keka sync jobs AFTER a ledger insert commits. Use `enqueueKekaSync(eventId)` helper in `backend/src/queues/enqueue.ts`.

8) Gatekeeper integration
- The Start Shift Slack modal should call `validateShiftPlan()` in `backend/src/services/ai/gatekeeper.ts`. On `valid: true` insert `CLOCK_IN` event. On `false` return validation error to Slack UI. For availability-first fallback, allow insert but mark `payload.gatekeeper_status = 'SKIPPED'`.

9) Reconciliation
- Create a periodic reconciliation job to scan `attendance_events` with `sync_status != 'SUCCESS'` and attempt re-processing or surface to admins.

10) Tests
- Add unit tests for DB trigger behaviour (pgTAP) and for worker logic (mock Keka). Create CI jobs to run these tests before deploy.

11) Monitoring
- Monitor `daily_status.has_sync_errors`, `attendance_events.sync_status` distribution, worker logs, and Keka API error rates.

12) Contact points
- For policy decisions, contact Sachit.

End of handover
