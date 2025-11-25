import 'dotenv/config';
import axios from 'axios';
import { Pool } from 'pg';

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error('Usage: tsx map_slack_for_employee.ts <employee_id>');
    process.exit(2);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const r = await client.query('SELECT id, email, slack_user_id FROM employees WHERE id = $1 LIMIT 1', [id]);
    if (r.rows.length === 0) {
      console.error('Employee not found', id);
      process.exit(3);
    }
    const emp = r.rows[0];
    console.log('Employee:', emp.id, emp.email, 'current slack_user_id=', emp.slack_user_id);
    if (emp.slack_user_id) {
      console.log('slack_user_id already present, nothing to do.');
      return;
    }
    if (!emp.email) {
      console.error('Employee missing email, cannot lookup Slack by email.');
      process.exit(4);
    }

    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      console.error('Missing SLACK_BOT_TOKEN in env');
      process.exit(5);
    }

    console.log('Looking up Slack user by email:', emp.email);
    const url = `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(emp.email)}`;
    const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } }).catch(e => e.response || { data: { ok: false, error: e.message } });
    if (!res || !res.data) {
      console.error('Slack API returned no data');
      process.exit(6);
    }
    if (!res.data.ok) {
      console.error('Slack API error:', res.data.error);
      process.exit(7);
    }
    const slackId = res.data.user && res.data.user.id;
    if (!slackId) {
      console.error('Slack user id missing in response');
      process.exit(8);
    }

    await client.query('UPDATE employees SET slack_user_id = $1, updated_at = NOW() WHERE id = $2', [slackId, id]);
    console.log('Updated employee', id, 'with slack_user_id', slackId);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(10); });
