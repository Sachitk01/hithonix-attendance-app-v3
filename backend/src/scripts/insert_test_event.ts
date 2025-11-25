import { Pool } from 'pg';
import { enqueueKekaSync } from '../queues/enqueue';

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // Pick a test employee; allow override via env TEST_EMPLOYEE_EMAIL
    const testEmail = process.env.TEST_EMPLOYEE_EMAIL;
    let empRes;
    if (testEmail) {
      empRes = await pool.query('SELECT id FROM employees WHERE email = $1 LIMIT 1', [testEmail]);
    } else {
      empRes = await pool.query('SELECT id FROM employees LIMIT 1');
    }
    if (empRes.rows.length === 0) {
      console.error('No employee found to use for test. Set TEST_EMPLOYEE_EMAIL in .env or ensure employees table has rows.');
      process.exit(2);
    }
    const employeeId = empRes.rows[0].id;

    const now = new Date();
    const eventTimestampUtc = now.toISOString();
    // IST = UTC + 5:30
    const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
    const ist = new Date(Date.now() + istOffsetMs);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const istDate = `${ist.getFullYear()}-${pad(ist.getMonth() + 1)}-${pad(ist.getDate())}`;
    const istDateTime = `${istDate} ${pad(ist.getHours())}:${pad(ist.getMinutes())}:${pad(ist.getSeconds())}`;

    // event_timestamp_ist is a GENERATED column in the schema; do NOT insert into it directly.
    // Let the DB trigger/generation compute event_timestamp_ist and business_date_ist when possible.
    const insertRes = await pool.query(
      `INSERT INTO attendance_events (employee_id, event_type, source, event_timestamp_utc, sync_status, meta)
       VALUES ($1, 'CLOCK_IN', 'TEST', $2, 'PENDING', $3)
       RETURNING id, created_at, employee_id`,
      [employeeId, eventTimestampUtc, { test: true }]
    );

    console.log('Inserted test attendance event:', insertRes.rows[0]);
    try {
      await enqueueKekaSync(insertRes.rows[0].id);
      console.log('Enqueued keka sync for event', insertRes.rows[0].id);
    } catch (e: any) {
      console.error('Failed to enqueue keka sync:', e && e.message ? e.message : String(e));
    }
    process.exit(0);
  } catch (err: any) {
    console.error('Failed to insert test event:', err && err.message ? err.message : err);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
