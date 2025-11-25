import { Worker, Job } from 'bullmq';
import axios from 'axios';
import type { Pool } from 'pg';
import KekaService from './keka.service';

import { connection } from '../../queues/connection';

// Use `any` for pool to avoid pg type resolution issues in this project's build environment.
export async function runKekaHealthCheck(pool: any, kekaService: KekaService) {
  console.info('HEALTHCHECK START');
  let oauth_ok = false, hris_ok = false, ingestion_ok = false, error_details = '';
  try {
    // OAuth check
    try {
      const token = await kekaService.getAccessToken();
      oauth_ok = !!token;
    } catch (e) { const err = e as Error; error_details += 'oauth: ' + (err.message || String(err)) + '\n'; }
    // HRIS check
    try {
      const res = await kekaService.searchByEmail('test@hithonix.com');
      hris_ok = !!res && res.succeeded;
  } catch (e) { const err = e as Error; error_details += 'hris: ' + (err.message || String(err)) + '\n'; }
    // Ingestion check
    try {
      const payload = [{ DeviceIdentifier: (process.env.KEKA_DEVICE_ID || '').trim(), EmployeeAttendanceNumber: 'TEST_HEALTH', Timestamp: '2025-01-01T00:00:00', Status: 0 }];
      const res = await axios.post(process.env.KEKA_ATTENDANCE_BASE_URL, payload, { headers: { 'X-API-Key': process.env.KEKA_ATTENDANCE_API_KEY, 'Content-Type': 'application/json' } });
      ingestion_ok = !!res.data && res.data.succeeded;
  } catch (e) { const err = e as Error; error_details += 'ingestion: ' + (err.message || String(err)) + '\n'; }
    await pool.query(`INSERT INTO keka_health_logs (oauth_ok, hris_ok, ingestion_ok, error_details) VALUES ($1, $2, $3, $4)`, [oauth_ok, hris_ok, ingestion_ok, error_details]);
    console.info(`oauth_ok=${oauth_ok} hris_ok=${hris_ok} ingestion_ok=${ingestion_ok}`);
    if (error_details) console.error('errors:', error_details);
  } catch (e) {
    const err = e as Error;
    console.error('HEALTHCHECK FATAL:', err.message || String(err));
  }
}

export function startKekaHealthWorker(pool: any, kekaService: KekaService) {
  new Worker('keka-health', async (job: Job) => {
    await runKekaHealthCheck(pool, kekaService);
  });
}
