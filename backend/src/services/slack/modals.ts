export function startShiftModal(triggerId?: string) {
  return {
    type: 'modal',
    callback_id: 'start_shift_modal',
    title: { type: 'plain_text', text: 'Start Shift' },
    submit: { type: 'plain_text', text: 'Start' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'plan_block',
        label: { type: 'plain_text', text: 'Daily plan (short)' },
        element: { type: 'plain_text_input', action_id: 'plan_input', multiline: true }
      }
    ]
  };
}
