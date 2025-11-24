import { getAppPool } from '../../db/pool';

export async function renderManagerHomeByManagerId(managerId: string) {
  const pool = getAppPool();
  const q = `SELECT
    e.id as employee_id,
    e.full_name,
    e.email,
    ds.current_status,
    ds.last_event_timestamp_utc,
    ds.has_sync_errors
  FROM employee_hierarchy_v h
  JOIN employees e ON e.id = h.employee_id
  LEFT JOIN daily_status ds
    ON ds.employee_id = e.id
    AND ds.business_date_ist = (now() AT TIME ZONE 'Asia/Kolkata')::date
  WHERE h.manager_id = $1
  ORDER BY (ds.has_sync_errors::int) DESC, (ds.current_status = 'LOCKED')::int DESC, (ds.current_status = 'LATE')::int DESC, e.full_name ASC`;

  const res = await pool.query(q, [managerId]);

  const blocks: any[] = [];
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*Team status*' } });
  blocks.push({ type: 'divider' });

  if (res.rows.length === 0) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_No reporting team found or no data available for today._' } });
    return { type: 'home', blocks };
  }

  for (const r of res.rows) {
    const status = r.current_status || 'OFF_DUTY';
    const color = r.has_sync_errors ? ':red_circle:' : (status === 'ON_SHIFT' ? ':large_green_circle:' : ':large_yellow_circle:');
    const lastPunch = r.last_event_timestamp_utc ? new Date(r.last_event_timestamp_utc).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `${color} *${r.full_name}* — ${status}\n${lastPunch}` } });
    // Add a button to open the timeline for this employee
    blocks.push({ type: 'actions', elements: [ { type: 'button', text: { type: 'plain_text', text: 'View Timeline' }, action_id: 'open_timeline', value: r.employee_id } ] });
  }

  return { type: 'home', blocks };
}

export default { renderManagerHomeByManagerId };
