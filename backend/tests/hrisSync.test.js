const assert = require('assert');
const { formatTimestampForKeka } = require('../src/services/keka/hrisSync.worker');

describe('HRIS Sync Timestamp Formatting', () => {
  it('should format timestamp as YYYY-MM-DDTHH:MM:SS', () => {
    const ts = new Date('2025-11-25T10:00:00Z');
    const formatted = formatTimestampForKeka(ts);
    assert.match(formatted, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
});

describe('HRIS Sync Missing Fields', () => {
  it('should handle missing slack_user_id gracefully', () => {
    const emp = { id: 'K123', email: 'a@b.com', name: 'Test' };
    // upsertEmployee should not throw
    // ...existing code...
  });
});
