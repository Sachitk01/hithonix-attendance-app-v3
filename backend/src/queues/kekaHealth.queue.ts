import { Queue } from 'bullmq';
import { connection } from './connection';

export const kekaHealthQueue = new Queue('keka-health', { connection });

export default kekaHealthQueue;
