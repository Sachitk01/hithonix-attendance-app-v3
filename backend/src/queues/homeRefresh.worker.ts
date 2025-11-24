import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { getAppPool } from '../db/pool';
import { WebClient } from '@slack/web-api';
import { renderHomeTab } from '../services/slack/home_tab';
import { renderManagerHomeByManagerId } from '../services/slack/manager_home';

const connection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

export function startHomeRefreshWorker() {
  const worker = new Worker('home-refresh', async (job: Job) => {
    const { employeeId } = job.data as { employeeId: string };
    const pool = getAppPool();
    // resolve slack_user_id for employee
    const res = await pool.query('SELECT slack_user_id FROM employees WHERE id = $1 LIMIT 1', [employeeId]);
    if (!res.rows.length) return;
    const slackUserId = res.rows[0].slack_user_id;
    if (!slackUserId) return;

    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) return;
    const client = new WebClient(token);

    // render home and publish
    const view = await renderHomeTab(slackUserId);
    await client.views.publish({ user_id: slackUserId, view });
    // Publish updated manager homes for managers of this employee
    try {
      const mgrs = await pool.query('SELECT manager_id FROM employee_hierarchy_v WHERE employee_id = $1', [employeeId]);
      for (const m of mgrs.rows) {
        if (!m.manager_id) continue;
        const mgrUser = await pool.query('SELECT slack_user_id FROM employees WHERE id = $1 LIMIT 1', [m.manager_id]);
        if (!mgrUser.rows.length) continue;
        const mgrSlack = mgrUser.rows[0].slack_user_id;
        if (!mgrSlack) continue;
        try {
          const mgrView = await renderManagerHomeByManagerId(m.manager_id);
          await client.views.publish({ user_id: mgrSlack, view: mgrView });
        } catch (e) { /* non-fatal */ }
      }
    } catch (e) { /* non-fatal */ }
  }, { connection, concurrency: 5 });

  worker.on('failed', (job, err) => {
    console.error('HomeRefresh job failed', job?.id, err);
  });

  return worker;
}

if (require.main === module) {
  startHomeRefreshWorker();
  console.log('Home refresh worker started');
}
