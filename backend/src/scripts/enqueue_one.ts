import 'dotenv/config';
import { enqueueKekaSync } from '../queues/enqueue';

const id = process.argv[2];
if (!id) {
  console.error('Usage: tsx enqueue_one.ts <attendance_event_id>');
  process.exit(2);
}

enqueueKekaSync(id).then(() => console.log('enqueued', id)).catch((e) => { console.error('enqueue failed', e); process.exit(1); });
