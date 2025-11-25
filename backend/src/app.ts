import { App, LogLevel } from '@slack/bolt';
import { registerHandlers } from './services/slack/actions';
import { getAppPool } from './db/pool';
import { hrisSyncQueue } from './queues/hrisSync.queue';
import { kekaHealthQueue } from './queues/kekaHealth.queue';
import { kekaSyncQueue } from './queues/kekaSync.queue';

// Initialize Bolt App using env vars. This module is the runtime entry for the Slack app.
export function initSlackApp() {
	const botToken = process.env.SLACK_BOT_TOKEN;
	const appToken = process.env.SLACK_APP_TOKEN;
	const signingSecret = process.env.SLACK_SIGNING_SECRET;
	if (!botToken || !appToken || !signingSecret) {
		throw new Error('Missing Slack env vars: SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET');
	}

	const app = new App({
		token: botToken,
		appToken,
		signingSecret,
		socketMode: true,
		logLevel: LogLevel.INFO,
	});

	// Provide helper to map slack_user_id -> employee row
	app.context.findEmployeeBySlackId = async (slackUserId: string) => {
		const pool = getAppPool();
		const res = await pool.query(`SELECT id, full_name, email FROM employees WHERE slack_user_id = $1 LIMIT 1`, [slackUserId]);
		return res.rows[0] || null;
	};

	// Register action/view handlers
	registerHandlers(app);

	return app;
}

if (require.main === module) {
	(async () => {
		const app = initSlackApp();
		await app.start();
			console.log('Slack app running');

			if (process.env.IS_PRIMARY_APP_INSTANCE === '1') {
				try {
					await hrisSyncQueue.add('hris-sync-recurring', {}, { repeat: { cron: '0 * * * *' } });
					await kekaHealthQueue.add('health-monitor', {}, { repeat: { cron: '*/5 * * * *' } });
					// Ensure attendance sync queue exists (no-op if already present)
					await kekaSyncQueue.add('keka-sync-recurring', {}, { repeat: { cron: '*/15 * * * *' } }).catch(() => {});
					console.log('Registered recurring queues (hrisSync, kekaHealth, kekaSync)');
				} catch (err) {
					console.error('Failed to register recurring jobs:', (err as Error).message || err);
				}
			}
	})().catch(err => {
		console.error('Failed to start Slack app', err);
		process.exit(1);
	});
}

