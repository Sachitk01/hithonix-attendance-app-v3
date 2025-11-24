import { kekaSyncQueue } from './kekaSync.queue';

export async function enqueueKekaSync(eventId: string) {
  await kekaSyncQueue.add('push-to-keka', { attendanceEventId: eventId }, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: false
  });
}
