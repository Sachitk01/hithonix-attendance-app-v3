function mapSqlErrorToUserMessage(err) {
  const msg = (err && err.message) ? err.message : String(err);
  if (msg.includes('Double CLOCK_IN')) return 'You have already clocked in for today.';
  if (msg.includes('Previous BREAK_START without BREAK_END')) return 'You cannot start another break until the previous break has ended.';
  if (msg.match(/BREAK_END without/i)) return 'You cannot end a break because no break has started.';
  if (msg.includes('LUNCH')) return 'Lunch policy violation.';
  if (msg.includes('EARLY_CLOCK_OUT_BEFORE_7PM')) return 'You cannot log out before 7 PM.';
  return msg;
}

module.exports = { mapSqlErrorToUserMessage };
