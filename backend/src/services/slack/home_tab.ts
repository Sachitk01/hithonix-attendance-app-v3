import { getAppPool } from '../../db/pool';
import { renderManagerHomeByManagerId } from './manager_home';

export async function renderHomeTab(slackUserId: string) {
  const pool = getAppPool();
  // Resolve employee row by slack id
  const empRes = await pool.query(`SELECT id, full_name FROM employees WHERE slack_user_id = $1 LIMIT 1`, [slackUserId]);
  if (empRes.rows.length === 0) {
    return { type: 'home', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'No employee record found. Please contact HR to link your Slack account.' } }] };
  }

  const employee = empRes.rows[0];

  // If this employee is a manager (has reports), render Manager Home
  const mgrCheck = await pool.query(`SELECT 1 FROM employee_hierarchy_v WHERE manager_id = $1 LIMIT 1`, [employee.id]);
  if (mgrCheck.rows.length) {
    return renderManagerHomeByManagerId(employee.id);
  }

  const q = `SELECT
    e.id AS employee_id,
    e.full_name,
    e.email,
    ds.current_status,
    ds.break_minutes_used,
    ds.business_date_ist,
    ds.last_event_timestamp_utc,
    ds.has_sync_errors
  FROM employees e
  LEFT JOIN daily_status ds
    ON ds.employee_id = e.id
    AND ds.business_date_ist = (now() AT TIME ZONE 'Asia/Kolkata')::date
  WHERE e.slack_user_id = $1`;

  const res = await pool.query(q, [slackUserId]);
  const row = res.rows[0];

  // Fetch last punch and timeline for quick preview
  const lastQ = `SELECT event_type, event_timestamp_utc FROM attendance_events WHERE employee_id = $1 AND business_date_ist = (now() AT TIME ZONE 'Asia/Kolkata')::date ORDER BY event_timestamp_utc DESC LIMIT 1`;
  const timelineQ = `SELECT event_type, event_timestamp_utc FROM attendance_events WHERE employee_id = $1 AND business_date_ist = (now() AT TIME ZONE 'Asia/Kolkata')::date ORDER BY event_timestamp_utc DESC LIMIT 8`;
  const lastRes = await pool.query(lastQ, [row.employee_id]);
  const timelineRes = await pool.query(timelineQ, [row.employee_id]);

  const status = row.current_status || 'OFF_DUTY';
  const traffic = row.has_sync_errors ? ':red_circle:' : (status === 'ON_SHIFT' ? ':large_green_circle:' : ':white_circle:');

  const blocks: any[] = [];

  // Header with traffic light and status
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*${row.full_name}* ${traffic}\n*Status:* ${status}` } });

  // Last punch and shift summary
  const lastPunchText = lastRes.rows.length ? `${lastRes.rows[0].event_type} at ${new Date(lastRes.rows[0].event_timestamp_utc).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}` : 'No punches today';
  blocks.push({ type: 'section', fields: [ { type: 'mrkdwn', text: `*Last punch:*
${lastPunchText}` }, { type: 'mrkdwn', text: `*Break used:*
${row.break_minutes_used || 0} minutes` } ] });

  // Action buttons
  blocks.push({ type: 'actions', elements: [
    { type: 'button', text: { type: 'plain_text', text: 'Start Shift' }, action_id: 'clock_in' },
    { type: 'button', text: { type: 'plain_text', text: 'End Shift' }, action_id: 'clock_out' },
    { type: 'button', text: { type: 'plain_text', text: 'Break Start' }, action_id: 'break_start' },
    { type: 'button', text: { type: 'plain_text', text: 'Break End' }, action_id: 'break_end' }
  ]});

  // Timeline preview
  blocks.push({ type: 'divider' });
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*Today — Timeline*' } });
  if (timelineRes.rows.length === 0) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_No events recorded today_' } });
  } else {
    for (const ev of timelineRes.rows) {
      const ts = new Date(ev.event_timestamp_utc).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
      blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `• ${ts} — ${ev.event_type}` }] });
    }
  }

  // AI insights footer (placeholder)
  blocks.push({ type: 'divider' });
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '_AI Insights: your plan looks good. (Gatekeeper summary available in Start Shift modal)_'}] });

  return { type: 'home', blocks };
}
