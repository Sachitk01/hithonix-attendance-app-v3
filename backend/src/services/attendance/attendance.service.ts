import { getAppPool } from '../../db/pool';
import { enqueueHomeRefresh } from '../../queues/enqueue';

const pool = getAppPool();

export function mapSqlErrorToUserMessage(err: any): string {
  const msg = (err && err.message) ? err.message : String(err);
  if (msg.includes('Double CLOCK_IN')) return 'You have already clocked in for today.';
  if (msg.includes('Previous BREAK_START without BREAK_END')) return 'You cannot start another break until the previous break has ended.';
  if (msg.match(/BREAK_END without/i)) return 'You cannot end a break because no break has started.';
  if (msg.includes('LUNCH')) return 'Lunch policy violation.';
  if (msg.includes('EARLY_CLOCK_OUT_BEFORE_7PM')) return 'You cannot log out before 7 PM.';
  // default
  return msg;
}

export async function insertAttendanceEvent(params: { employee_id: string; event_type: string; payload?: any; created_by_slack_id?: string; }) {
  const { employee_id, event_type, payload = null, created_by_slack_id = null } = params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q = `INSERT INTO attendance_events (employee_id, event_type, event_timestamp_utc, payload, created_by_slack_id) VALUES ($1, $2, now(), $3, $4) RETURNING id`;
    const res = await client.query(q, [employee_id, event_type, payload, created_by_slack_id]);
    await client.query('COMMIT');
    // Enqueue home refresh for the employee to update Slack Home UI
    try { await enqueueHomeRefresh(employee_id); } catch (e) { /* non-fatal */ }
    return res.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    const friendly = mapSqlErrorToUserMessage(err);
    const error: any = new Error(friendly);
    error.original = err;
    throw error;
  } finally {
    client.release();
  }
}

export default { insertAttendanceEvent, mapSqlErrorToUserMessage };
