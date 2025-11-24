#!/usr/bin/env node
/*
  backfill_business_date.js

  Usage:
    NODE_ENV=development DATABASE_URL="postgres://..." node backend/scripts/backfill_business_date.js --limit=500 --apply

  This script scans attendance_events where business_date_ist is NULL or mismatches
  the derived value from event_timestamp_utc AT TIME ZONE 'Asia/Kolkata'. By default
  it only reports findings. If --apply is present, it updates rows in small batches
  and writes an entry into audit_logs for each update. NOTE: updating attendance_events
  is an exceptional, one-time repair operation and violates the strict 'no UPDATE'
  ledger invariant — only run with explicit approval and after backups.

*/
const { Pool } = require('pg');
// Simple arg parsing to avoid extra deps
const rawArgs = process.argv.slice(2);
const argv = {};
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a.startsWith('--')) {
    const k = a.replace(/^--/, '');
    const v = rawArgs[i+1] && !rawArgs[i+1].startsWith('--') ? rawArgs[++i] : true;
    argv[k] = v;
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Please set DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

const BATCH_LIMIT = parseInt(argv.limit, 10) || 500;
const DRY_RUN = !argv.apply;

async function findMismatches(limit) {
  const client = await pool.connect();
  try {
    const q = `SELECT id, employee_id, event_timestamp_utc, business_date_ist
               FROM attendance_events
               WHERE business_date_ist IS NULL
                  OR business_date_ist <> (event_timestamp_utc AT TIME ZONE 'Asia/Kolkata')::date
               ORDER BY created_at ASC
               LIMIT $1`;
    const res = await client.query(q, [limit]);
    return res.rows;
  } finally {
    client.release();
  }
}

async function applyUpdate(row) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const computed = await client.query("SELECT ( $1::timestamptz AT TIME ZONE 'Asia/Kolkata')::date as computed_date", [row.event_timestamp_utc]);
    const newDate = computed.rows[0].computed_date;
    const updateRes = await client.query(
      'UPDATE attendance_events SET business_date_ist = $1 WHERE id = $2 RETURNING business_date_ist',
      [newDate, row.id]
    );
    await client.query(
      `INSERT INTO audit_logs (actor_slack_id, target_employee_id, action, reason, context)
       VALUES ($1, $2, $3, $4, $5)`,
      [ 'system.backfill', row.employee_id, 'BACKFILL_BUSINESS_DATE', 'Set business_date_ist to derived IST date', JSON.stringify({ event_id: row.id, new_date: newDate }) ]
    );
    await client.query('COMMIT');
    return { id: row.id, updated: true, newDate };
  } catch (err) {
    await client.query('ROLLBACK');
    return { id: row.id, updated: false, error: err.message };
  } finally {
    client.release();
  }
}

async function main() {
  console.log('DRY_RUN=', DRY_RUN, 'limit=', BATCH_LIMIT);
  const rows = await findMismatches(BATCH_LIMIT);
  console.log(`Found ${rows.length} mismatched rows (showing up to ${BATCH_LIMIT}).`);
  if (rows.length === 0) {
    await pool.end();
    return;
  }

  for (const r of rows) {
    const computed = (new Date(r.event_timestamp_utc)).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }).split(',')[0];
    console.log(`id=${r.id} employee=${r.employee_id} current=${r.business_date_ist} event_ts=${r.event_timestamp_utc}`);
    if (!DRY_RUN) {
      const result = await applyUpdate(r);
      if (result.updated) console.log(` -> updated to ${result.newDate}`);
      else console.error(' -> failed', result.error);
    }
  }

  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
