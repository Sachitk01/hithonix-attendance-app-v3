import { Queue, Worker, Job } from 'bullmq';
import axios from 'axios';
import type { Pool } from 'pg';
import KekaService from './keka.service';

// Using `any` for pool here to avoid type resolution issues with the project's TypeScript setup.
export async function upsertEmployee(pool: any, emp: any) {
  // Upsert logic for employees table
  const { id: keka_id, email: workEmail, name: fullName } = emp;
  await pool.query(`
    INSERT INTO employees (keka_id, workEmail, fullName, raw_keka_profile)
    VALUES ($1, $2, $3, $4::jsonb)
    ON CONFLICT (keka_id) DO UPDATE
    SET workEmail = EXCLUDED.workEmail,
        fullName = EXCLUDED.fullName,
        raw_keka_profile = EXCLUDED.raw_keka_profile
  `, [keka_id, workEmail, fullName, JSON.stringify(emp)]);
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
  new Worker('hrisSyncQueue', async (job: Job) => {
    await runHrisSync(pool, kekaService);
  });
}
