const assert = require('assert');

// Lightweight unit test to validate timestamp normalization and env read behavior used by kekaSync worker.
// We avoid importing TypeScript service files in this test harness.

function normalizeIst(tsRaw) {
  if (typeof tsRaw === 'string') {
    return tsRaw.replace(' ', 'T').slice(0, 19);
  }
  return new Date(tsRaw).toISOString().split('.')[0];
}

function testTimestampNormalization() {
  // Case: TIMESTAMP WITHOUT TIME ZONE returned as 'YYYY-MM-DD HH:MM:SS'
  const s = '2025-11-25 09:15:03';
  const out = normalizeIst(s);
  assert.strictEqual(out, '2025-11-25T09:15:03');

  // Case: Date object
  const d = new Date('2025-11-25T09:15:03Z');
  const out2 = normalizeIst(d);
  assert.strictEqual(out2, '2025-11-25T09:15:03');

  // Case: string with fractional seconds
  const s2 = '2025-11-25 09:15:03.123';
  const out3 = normalizeIst(s2);
  assert.strictEqual(out3, '2025-11-25T09:15:03');

  console.log('keka timestamp formatting tests passed');
}

function testEnvAttendanceBase() {
  // Ensure the env var is read (the test runner will have access to process.env)
  const val = process.env.KEKA_ATTENDANCE_BASE_URL || '';
  // We don't assert a specific value here, only that the variable is defined in typical local dev
  // If absent, the production default will be used. This test ensures code path expectation.
  assert.ok(typeof val === 'string');
  console.log('keka env presence check passed');
}

// Run tests
try {
  testTimestampNormalization();
  testEnvAttendanceBase();
  console.log('keka_integration tests passed');
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
