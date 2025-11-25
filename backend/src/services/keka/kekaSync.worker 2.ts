import { getWorkerPool } from '../../db/pool';
import KekaService from './keka.service';
import { startKekaSyncWorker } from '../queues/kekaSync.queue';

export function startWorker() {
  const pool = getWorkerPool();
  const keka = new KekaService(pool, { apiKey: process.env.KEKA_API_KEY || '' });
  const worker = startKekaSyncWorker(pool, keka);
  console.log('Keka sync worker started');
  return { worker };
}

if (require.main === module) {
  startWorker();
}
