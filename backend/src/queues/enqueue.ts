import { kekaSyncQueue } from './kekaSync.queue';
import { homeRefreshQueue } from './homeRefresh.queue';

export async function enqueueKekaSync(eventId: string) {
  await kekaSyncQueue.add('push-to-keka', { attendanceEventId: eventId }, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: false
  });
}

export async function enqueueHomeRefresh(employeeId: string) {
  await homeRefreshQueue.add('publish-home', { employeeId }, {
    attempts: 3,
    removeOnComplete: true,
    removeOnFail: false
  });
}
