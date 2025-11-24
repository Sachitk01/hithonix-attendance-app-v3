const assert = require('assert');
const { mapSqlErrorToUserMessage } = require('../src/services/attendance/attendance.service');

function test() {
  assert.strictEqual(mapSqlErrorToUserMessage({ message: 'Double CLOCK_IN detected for employee' }), 'You have already clocked in for today.');
  assert.strictEqual(mapSqlErrorToUserMessage({ message: 'Previous BREAK_START without BREAK_END exists' }), 'You cannot start another break until the previous break has ended.');
  assert.strictEqual(mapSqlErrorToUserMessage({ message: 'BREAK_END without START' }), 'You cannot end a break because no break has started.');
  assert.strictEqual(mapSqlErrorToUserMessage({ message: 'LUNCH_EXCEEDS_LIMIT' }).startsWith('Lunch'), true);
  console.log('attendance_error_mapping tests passed');
}

test();
