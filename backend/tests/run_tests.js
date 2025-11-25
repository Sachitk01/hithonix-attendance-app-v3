const { spawnSync } = require('child_process');
const tests = [
  'backend/tests/attendance_error_mapping.test.js',
  'backend/tests/gatekeeper.test.js',
  'backend/tests/keka_integration.test.js'
];

for (const t of tests) {
  console.log('Running', t);
  const r = spawnSync('node', [t], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status);
}
console.log('All tests passed');
