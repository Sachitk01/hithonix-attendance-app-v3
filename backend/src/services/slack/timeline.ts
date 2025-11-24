import { getAppPool } from '../../db/pool';

export async function renderEmployeeTimelineModal(employeeId: string, businessDate: string) {
  const pool = getAppPool();
  const q = `SELECT event_type, event_timestamp_utc, payload FROM attendance_events WHERE employee_id = $1 AND business_date_ist = $2::date ORDER BY event_timestamp_utc ASC`;
  const res = await pool.query(q, [employeeId, businessDate]);

  const blocks: any[] = [];
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*Employee timeline*' } });
  blocks.push({ type: 'divider' });

  if (res.rows.length === 0) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_No events for this day._' } });
  } else {
    for (const ev of res.rows) {
      const ts = new Date(ev.event_timestamp_utc).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
      let emoji = '•';
      if (ev.event_type === 'CLOCK_IN') emoji = ':large_green_circle:';
      if (ev.event_type === 'CLOCK_OUT') emoji = ':white_circle:';
      if (ev.event_type === 'BREAK_START') emoji = ':small_orange_diamond:';
      if (ev.event_type === 'BREAK_END') emoji = ':small_blue_diamond:';
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `${emoji} *${ev.event_type}* — ${ts}` } });
      if (ev.payload) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `_${JSON.stringify(ev.payload)}_` }] });
    }
  }

  return {
    type: 'modal',
    title: { type: 'plain_text', text: 'Timeline' },
    close: { type: 'plain_text', text: 'Close' },
    blocks,
  };
}

export default { renderEmployeeTimelineModal };
