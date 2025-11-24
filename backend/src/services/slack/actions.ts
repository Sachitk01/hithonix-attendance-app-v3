import { startShiftModal } from './modals';
import { insertAttendanceEvent } from '../attendance/attendance.service';
import { enqueueKekaSync } from '../../queues/enqueue';
import { validateShiftPlan } from '../ai/gatekeeper';
import { renderHomeTab } from './home_tab';

// These handler functions are meant to be registered with a Slack Bolt `app` instance.
export function registerHandlers(app: any) {
  // Clock In button pressed
  app.action('clock_in', async ({ ack, body, client, logger }: any) => {
    await ack();
    try {
      await client.views.open({ trigger_id: body.trigger_id, view: startShiftModal() });
    } catch (err) { logger.error(err); }
  });

  // View submission for start shift
  app.view('start_shift_modal', async ({ ack, body, view, logger, client }) => {
    const user = body.user.id;
    const plan = view.state.values.plan_block.plan_input.value;
    // Call Gatekeeper
    try {
      const g = await validateShiftPlan(user, plan);
      if (!g.valid) {
        await ack({ response_action: 'errors', errors: { 'plan_block': g.reason || 'Invalid plan' } });
        return;
      }
    } catch (err) {
      // Gatekeeper failure: surface a generic error but allow fallback to proceed
      logger.error('Gatekeeper error', err);
      await ack({ response_action: 'errors', errors: { 'plan_block': 'Gatekeeper unavailable. Please try again.' } });
      return;
    }

  await ack();

    // Map Slack user to employee_id (lookup in employees by slack_user_id)
    try {
      const res = await client.users.lookupByEmail({ email: body.user.email }).catch(() => null);
      // The real mapping should query employees table using slack_user_id; we will call a DB query
      // Here we expect a helper on app called findEmployeeBySlackId
      const employee = await app.context.findEmployeeBySlackId(user);
      if (!employee) {
        await client.chat.postMessage({ channel: user, text: 'Employee record not found. Please contact HR.' });
        return;
      }

      // Insert attendance event (CLOCK_IN) — DB enforces state transitions
      const ev = await insertAttendanceEvent({ employee_id: employee.id, event_type: 'CLOCK_IN', payload: { plan: plan }, created_by_slack_id: user });
      // Enqueue sync job
      await enqueueKekaSync(ev.id);
      // Refresh Home Tab after clock-in
      try {
        const home = await renderHomeTab(user);
        await client.views.publish({ user_id: user, view: home });
      } catch (e) {
        // ignore home tab refresh errors
      }

      await client.chat.postMessage({ channel: user, text: 'Clocked in successfully. Your plan has been recorded.' });
    } catch (err:any) {
      const msg = err.message || 'Failed to clock in.';
      await client.chat.postMessage({ channel: user, text: `Clock-in failed: ${msg}` });
    }
  });
}
