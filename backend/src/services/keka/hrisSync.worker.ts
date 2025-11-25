import { Queue, Worker, Job } from 'bullmq';
import { connection } from '../../queues/connection';
import axios from 'axios';
import type { Pool } from 'pg';
import KekaService from './keka.service';

// Using `any` for pool here to avoid type resolution issues with the project's TypeScript setup.
export async function upsertEmployee(pool: any, emp: any) {
  // Upsert logic for employees table. Align with existing schema in migrations/001_create_employees.sql
  // Use the canonical columns: keka_id, email, raw_keka_profile
  const { id: keka_id, email } = emp;
  await pool.query(`
    INSERT INTO employees (keka_id, email, raw_keka_profile)
    VALUES ($1, $2, $3::jsonb)
    ON CONFLICT (keka_id) DO UPDATE
    SET email = EXCLUDED.email,
        raw_keka_profile = EXCLUDED.raw_keka_profile
  `, [keka_id, email, JSON.stringify(emp)]);
}

export async function runHrisSync(pool: any, kekaService: KekaService) {
  const token = await kekaService.getAccessToken();
  const url = `${KekaService.KEKA_HRIS_BASE}/employees`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const employees = res.data.data || [];
  let newRows = 0, updatedRows = 0, missingSlack = 0;
  for (const emp of employees) {
    await upsertEmployee(pool, emp);
    // ...existing logic to count new/updated/missingSlack
  }
  console.info(`[hrisSync] newRows=${newRows} updatedRows=${updatedRows} missingSlack=${missingSlack}`);
}

export function startHrisSyncWorker(pool: any, kekaService: KekaService) {
  new Worker('hris-sync', async (job: Job) => {
    await runHrisSync(pool, kekaService);
  }, { connection });
}
