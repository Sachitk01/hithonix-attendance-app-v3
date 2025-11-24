import { getAppPool } from '../../db/pool';

export async function renderHomeTab(slackUserId: string) {
  const pool = getAppPool();
  const q = `SELECT
    e.id AS employee_id,
    e.full_name,
    e.email,
    ds.current_status,
    ds.break_minutes_used,
    ds.business_date_ist,
    ds.last_event_timestamp_utc
  FROM employees e
  LEFT JOIN daily_status ds
    ON ds.employee_id = e.id
    AND ds.business_date_ist = (now() AT TIME ZONE 'Asia/Kolkata')::date
  WHERE e.slack_user_id = $1`;

  const res = await pool.query(q, [slackUserId]);
  const row = res.rows[0];
  if (!row) {
    return {
      type: 'home',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'No employee record found.' } }]
    };
  }

  const status = row.current_status || 'OFF_DUTY';
  const blocks: any[] = [];
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*${row.full_name}*\nStatus: *${status}*` } });
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Break minutes used: ${row.break_minutes_used || 0}` }] });
  blocks.push({ type: 'actions', elements: [ { type: 'button', text: { type: 'plain_text', text: 'Clock In' }, action_id: 'clock_in' } ] });

  return { type: 'home', blocks };
}
