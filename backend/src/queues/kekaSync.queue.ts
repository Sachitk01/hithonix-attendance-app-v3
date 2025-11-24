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
        return;
      }
      const employee = empRes.rows[0];
      const employeeAttendanceNumber = employee.keka_id || (employee.raw_keka_profile && employee.raw_keka_profile.attendanceNumber);
      if (!employeeAttendanceNumber) {
        await client.query(`UPDATE attendance_events SET sync_status = 'FAILED', keka_response_body = $2 WHERE id = $1`, [ev.id, { error: 'missing_keka_attendance_number' }]);
        await client.query('COMMIT');
        return;
      }

      const kekaPayload = { timestamp: ev.event_timestamp_utc, type: ev.event_type, metadata: ev.payload ?? {} };
      let kekaResp: any;
      try {
        kekaResp = await kekaService.pushAttendance(employeeAttendanceNumber, kekaPayload);
      } catch (err: any) {
        await client.query(`UPDATE attendance_events SET sync_status = 'FAILED', keka_request_body = $2, keka_response_body = $3 WHERE id = $1`, [ev.id, kekaPayload, { error: err.message || String(err) }]);
        await client.query('COMMIT');
        throw err;
      }

      await client.query(`UPDATE attendance_events SET sync_status = 'SUCCESS', keka_request_body = $2, keka_response_body = $3 WHERE id = $1`, [ev.id, kekaPayload, kekaResp]);
      await client.query('COMMIT');
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
  });

  return worker;
}
