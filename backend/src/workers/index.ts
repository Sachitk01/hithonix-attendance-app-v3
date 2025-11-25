import { startWorker as startKekaWorker } from './kekaSync.worker';
import { startWorker as startHrisWorker } from './hrisSync.worker';
// Temporarily disable the health monitor worker to avoid noise during stabilization.
// import './kekaHealth.worker';

// Start the actual workers so they subscribe to their queues and process jobs.
startKekaWorker();
startHrisWorker();

console.log('KekaSync and HrisSync workers started. Health worker is disabled.');
