import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import type { Pool } from 'pg';
import KekaService from '../services/keka/keka.service';

const connection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

export const kekaSyncQueue = new Queue('keka-sync', { connection });

export interface KekaJobData { attendanceEventId: string }

export function startKekaSyncWorker(pool: Pool, kekaService: KekaService) {
  const worker = new Worker<KekaJobData>('keka-sync', async (job: Job<KekaJobData>) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`SELECT * FROM attendance_events WHERE id = $1 FOR UPDATE`, [job.data.attendanceEventId]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return; }
      const ev = rows[0];

      await client.query(`UPDATE attendance_events SET sync_status = 'PROCESSING', last_attempt_at = now(), attempt_count = attempt_count + 1 WHERE id = $1`, [ev.id]);

      const empRes = await client.query(`SELECT keka_id, raw_keka_profile FROM employees WHERE id = $1`, [ev.employee_id]);
      if (empRes.rows.length === 0) {
        await client.query(`UPDATE attendance_events SET sync_status = 'FAILED', keka_response_body = $2 WHERE id = $1`, [ev.id, { error: 'employee_not_found' }]);
        await client.query('COMMIT');
        try { const { enqueueHomeRefresh } = require('./enqueue'); await enqueueHomeRefresh(ev.employee_id); } catch (e) { /* non-fatal */ }
        return;
      }
      const employee = empRes.rows[0];
      const employeeAttendanceNumber = employee.keka_id || (employee.raw_keka_profile && employee.raw_keka_profile.attendanceNumber);
      if (!employeeAttendanceNumber) {
        await client.query(`UPDATE attendance_events SET sync_status = 'FAILED', keka_response_body = $2 WHERE id = $1`, [ev.id, { error: 'missing_keka_attendance_number' }]);
        await client.query('COMMIT');
        try { const { enqueueHomeRefresh } = require('./enqueue'); await enqueueHomeRefresh(ev.employee_id); } catch (e) { /* non-fatal */ }
        return;
      }

      // Map event_type to Keka status code: CLOCK_IN=0, CLOCK_OUT=1, BREAK_START=2, BREAK_END=3
      const statusMap: Record<string, number> = {
        'CLOCK_IN': 0,
        'CLOCK_OUT': 1,
        'BREAK_START': 2,
        'BREAK_END': 3,
      };
      const statusCode = statusMap[ev.event_type];
      if (statusCode === undefined) {
        await client.query(`UPDATE attendance_events SET sync_status = 'FAILED', keka_response_body = $2 WHERE id = $1`, [ev.id, { error: 'unknown_event_type' }]);
        await client.query('COMMIT');
        try { const { enqueueHomeRefresh } = require('./enqueue'); await enqueueHomeRefresh(ev.employee_id); } catch (e) { /* non-fatal */ }
        return;
      }

      // Prefer the stored IST timestamp (event_timestamp_ist) and format as "YYYY-MM-DDTHH:MM:SS"
      // event_timestamp_ist may come back as 'YYYY-MM-DD HH:MM:SS' (no timezone). Normalize to the expected Keka format.
      const tsIstRaw = ev.event_timestamp_ist || ev.event_timestamp_utc;
      let timestampIstNoOffset: string;
      if (typeof tsIstRaw === 'string') {
        // Normalize 'YYYY-MM-DD HH:MM:SS' -> 'YYYY-MM-DDTHH:MM:SS'
        timestampIstNoOffset = tsIstRaw.replace(' ', 'T').slice(0, 19);
      } else {
        // Fallback: produce ISO and strip fractional seconds and offset (rare)
        timestampIstNoOffset = new Date(tsIstRaw).toISOString().split('.')[0];
      }

      const kekaPayload = {
        deviceId: process.env.KEKA_DEVICE_ID!,
        employeeAttendanceNumber,
        timestamp: timestampIstNoOffset,
        status: statusCode,
      };
      console.info('kekaSync: pushing attendance for event', ev.id, 'employee', ev.employee_id, 'payload', kekaPayload);
      let kekaResp: any;
      try {
        kekaResp = await kekaService.pushAttendance(kekaPayload);
      } catch (err: any) {
        console.error('kekaSync: pushAttendance failed for event', ev.id, 'err=', err && err.message ? err.message : String(err));
        await client.query(`UPDATE attendance_events SET sync_status = 'FAILED', keka_request_body = $2, keka_response_body = $3 WHERE id = $1`, [ev.id, kekaPayload, { error: err.message || String(err) }]);
        await client.query('COMMIT');
        // let the worker surface the failure (so retries can happen); the worker 'failed' handler will enqueue a home refresh
        throw err;
      }

      console.info('kekaSync: pushAttendance succeeded for event', ev.id, 'response', kekaResp);

      await client.query(`UPDATE attendance_events SET sync_status = 'SUCCESS', keka_request_body = $2, keka_response_body = $3 WHERE id = $1`, [ev.id, kekaPayload, kekaResp]);
      await client.query('COMMIT');
        // After successful sync, enqueue a home refresh so Slack UI reflects new sync status
        try { const { enqueueHomeRefresh } = require('./enqueue'); await enqueueHomeRefresh(ev.employee_id); } catch (e) { /* non-fatal */ }
        return;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }, { connection, concurrency: 5 });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error('KekaSync job failed', job?.id, err);
    // On terminal job failures (exceptions), enqueue a home-refresh so Slack Home reflects the failed sync.
    (async () => {
      try {
        if (!job?.data?.attendanceEventId) return;
        const client = await pool.connect();
        try {
          const r = await client.query('SELECT employee_id FROM attendance_events WHERE id = $1', [job.data.attendanceEventId]);
          if (r.rows.length) {
            const { enqueueHomeRefresh } = require('./enqueue');
            await enqueueHomeRefresh(r.rows[0].employee_id);
          }
        } finally { client.release(); }
      } catch (e) { /* non-fatal */ }
    })();
  });

  return worker;
}
