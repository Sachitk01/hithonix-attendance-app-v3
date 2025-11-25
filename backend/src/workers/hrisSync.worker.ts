import { getWorkerPool } from '../db/pool';
import KekaService from '../services/keka/keka.service';
import { startHrisSyncWorker } from '../services/keka/hrisSync.worker';

export function startWorker() {
  const pool = getWorkerPool();
  const keka = new KekaService(pool, { apiKey: process.env.KEKA_API_KEY || '' });
  startHrisSyncWorker(pool, keka);
  console.log('HRIS sync worker started');
}

if (require.main === module) startWorker();
