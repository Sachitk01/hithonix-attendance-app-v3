import { Queue } from 'bullmq';
import { connection } from './connection';

export const hrisSyncQueue = new Queue('hris-sync', { connection });

export default hrisSyncQueue;
