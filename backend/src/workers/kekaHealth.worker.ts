import { getWorkerPool } from '../db/pool';
import KekaService from '../services/keka/keka.service';
import { startKekaHealthWorker } from '../services/keka/kekaHealth.worker';

export function startWorker() {
  const pool = getWorkerPool();
  const keka = new KekaService(pool, { apiKey: process.env.KEKA_API_KEY || '' });
  startKekaHealthWorker(pool, keka);
  console.log('Keka health worker started');
}

if (require.main === module) startWorker();
