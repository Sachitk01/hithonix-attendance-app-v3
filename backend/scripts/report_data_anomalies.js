#!/usr/bin/env node
/*
  report_data_anomalies.js

  Usage:
    NODE_ENV=development DATABASE_URL="postgres://..." node backend/scripts/report_data_anomalies.js --out=anomalies.json

  This script finds likely anomalies in the attendance_events ledger for manual review:
   - Multiple CLOCK_IN per (employee, date)
   - BREAK_START without corresponding BREAK_END
   - LUNCH_START/LUNCH_END mismatches

  It writes a JSON report to the --out file (default: anomalies.json)
*/
const { Pool } = require('pg');
const fs = require('fs');
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

const OUT = argv.out || 'anomalies.json';
const pool = new Pool({ connectionString: DATABASE_URL });

async function findDuplicateClockIns() {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT employee_id, business_date_ist, COUNT(*) as cnt
       FROM attendance_events
       WHERE event_type = 'CLOCK_IN'
       GROUP BY employee_id, business_date_ist
       HAVING COUNT(*) > 1
       ORDER BY cnt DESC
       LIMIT 1000`
    );
    return res.rows;
  } finally { client.release(); }
}

async function findUnclosedBreaks() {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT ae.employee_id, ae.business_date_ist, ae.id as break_start_id, ae.event_timestamp_utc as break_start_ts
       FROM attendance_events ae
       WHERE ae.event_type = 'BREAK_START'
         AND NOT EXISTS (
           SELECT 1 FROM attendance_events be
           WHERE be.employee_id = ae.employee_id
             AND be.business_date_ist = ae.business_date_ist
             AND be.event_type = 'BREAK_END'
             AND be.event_timestamp_utc > ae.event_timestamp_utc
         )
       LIMIT 1000`
    );
    return res.rows;
  } finally { client.release(); }
}

async function findLunchMismatches() {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT employee_id, business_date_ist,
              SUM(CASE WHEN event_type = 'LUNCH_START' THEN 1 ELSE 0 END) as lunch_starts,
              SUM(CASE WHEN event_type = 'LUNCH_END' THEN 1 ELSE 0 END) as lunch_ends
       FROM attendance_events
       GROUP BY employee_id, business_date_ist
       HAVING SUM(CASE WHEN event_type = 'LUNCH_START' THEN 1 ELSE 0 END) <> SUM(CASE WHEN event_type = 'LUNCH_END' THEN 1 ELSE 0 END)
       LIMIT 1000`
    );
    return res.rows;
  } finally { client.release(); }
}

async function main() {
  const [dupClockIns, unclosedBreaks, lunchMismatches] = await Promise.all([
    findDuplicateClockIns(), findUnclosedBreaks(), findLunchMismatches()
  ]);

  const report = { generated_at: new Date().toISOString(), dupClockIns, unclosedBreaks, lunchMismatches };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`Wrote ${OUT}`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
