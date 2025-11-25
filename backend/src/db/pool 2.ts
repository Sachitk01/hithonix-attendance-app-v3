import { Pool } from 'pg';

let appPool: Pool | null = null;
let workerPool: Pool | null = null;

export function getAppPool(): Pool {
  if (!appPool) {
    const conn = process.env.DATABASE_URL;
    if (!conn) throw new Error('DATABASE_URL not set for app pool');
    appPool = new Pool({ connectionString: conn });
  }
  return appPool;
}

export function getWorkerPool(): Pool {
  if (!workerPool) {
    const conn = process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL;
    if (!conn) throw new Error('WORKER_DATABASE_URL not set for worker pool');
    workerPool = new Pool({ connectionString: conn });
  }
  return workerPool;
}
