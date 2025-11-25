#!/usr/bin/env node

/**
 * backend/scripts/validate_keka_integration.js
 *
 * Complete Keka integration validation test suite:
 * 1. OAuth token exchange (kekaapi grant)
 * 2. HRIS employee search via Bearer token
 * 3. Attendance ingestion via X-API-Key
 *
 * Run: node backend/scripts/validate_keka_integration.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const fs = require('fs');

// ========== CONFIGURATION ==========

const KEKA_AUTH_URL = process.env.KEKA_AUTH_URL || 'https://login.keka.com/connect/token';
const KEKA_CLIENT_ID = process.env.KEKA_CLIENT_ID;
const KEKA_CLIENT_SECRET = process.env.KEKA_CLIENT_SECRET;
const KEKA_API_KEY = process.env.KEKA_API_KEY;
const KEKA_SCOPE = process.env.KEKA_SCOPE || 'kekaapi';
const KEKA_COMPANY_ALIAS = process.env.KEKA_COMPANY_ALIAS || 'hithonix';
const KEKA_ENV_DOMAIN = process.env.KEKA_ENV_DOMAIN || 'keka.com';
const KEKA_HRIS_BASE = `https://${KEKA_COMPANY_ALIAS}.${KEKA_ENV_DOMAIN}/api/v1/hris/`;
const KEKA_ATTENDANCE_BASE_URL = process.env.KEKA_ATTENDANCE_BASE_URL || 'https://cin03.a.keka.com/v1/logs';
const KEKA_ATTENDANCE_API_KEY = process.env.KEKA_ATTENDANCE_API_KEY;
const KEKA_DEVICE_ID = (process.env.KEKA_DEVICE_ID || '4f5b878d-7fe4-4b34-8eed-651b3d20c4c2').trim();

// ========== TEST RESULTS ==========

const results = {
  timestamp: new Date().toISOString(),
  tests: [],
  summary: {}
};

function log(message, level = 'info') {
  const prefix = {
    info: '[INFO]',
    success: '[✓]',
    error: '[✗]',
    debug: '[DEBUG]'
  }[level];
  console.log(`${prefix} ${message}`);
}

function recordTest(name, passed, details = {}) {
  results.tests.push({
    name,
    passed,
    timestamp: new Date().toISOString(),
    details
  });
  if (passed) {
    log(`${name}: PASSED`, 'success');
  } else {
    log(`${name}: FAILED`, 'error');
  }
}

// ========== TEST 1: OAuth Token Exchange (kekaapi grant) ==========

async function testOAuthToken() {
  log('TEST 1: OAuth Token Exchange (kekaapi grant)', 'info');
  
  try {
    if (!KEKA_CLIENT_ID || !KEKA_CLIENT_SECRET || !KEKA_API_KEY) {
      throw new Error('Missing credentials: KEKA_CLIENT_ID, KEKA_CLIENT_SECRET, or KEKA_API_KEY');
    }

    const body = new URLSearchParams();
    body.append('grant_type', 'kekaapi');
    body.append('scope', KEKA_SCOPE);
    body.append('client_id', KEKA_CLIENT_ID);
    body.append('client_secret', KEKA_CLIENT_SECRET);
    body.append('api_key', KEKA_API_KEY);

    log(`  POST ${KEKA_AUTH_URL}`, 'debug');
    log(`  Body: grant_type=kekaapi, scope=${KEKA_SCOPE}, client_id=${KEKA_CLIENT_ID.substring(0, 8)}...`, 'debug');

    const res = await fetch(KEKA_AUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        accept: 'application/json'
      },
      body
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const json = await res.json();
    if (!json.access_token) {
      throw new Error('No access_token in response');
    }

    log(`  ✓ Token acquired: ${json.access_token.substring(0, 20)}...`, 'debug');
    log(`  Expires in: ${json.expires_in} seconds`, 'debug');

    recordTest('OAuth Token Exchange (kekaapi)', true, {
      status: 200,
      token_prefix: json.access_token.substring(0, 20),
      expires_in: json.expires_in
    });

    return json.access_token;

  } catch (err) {
    recordTest('OAuth Token Exchange (kekaapi)', false, {
      error: err.message
    });
    log(`  ERROR: ${err.message}`, 'error');
    return null;
  }
}

// ========== TEST 2: HRIS Employee Search (Bearer token) ==========

async function testHRISSearch(token) {
  log('TEST 2: HRIS Employee Search (Bearer token)', 'info');
  
  if (!token) {
    recordTest('HRIS Employee Search', false, { error: 'No OAuth token available' });
    log('  ERROR: No OAuth token available', 'error');
    return null;
  }

  try {
    const url = new URL('employees', KEKA_HRIS_BASE);
    url.searchParams.set('pageNumber', '1');
    url.searchParams.set('pageSize', '5');

    log(`  GET ${url.toString()}`, 'debug');
    log(`  Authorization: Bearer ${token.substring(0, 20)}...`, 'debug');

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${token}`
      }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const json = await res.json();
    if (!json.succeeded) {
      throw new Error(`API response not succeeded: ${JSON.stringify(json.errors || [])}`);
    }

    const data = json.data || [];
    log(`  ✓ Retrieved ${data.length} employees (page 1 of ${json.totalPages})`, 'debug');
    log(`  Total records in Keka: ${json.totalRecords}`, 'debug');

    recordTest('HRIS Employee Search', true, {
      status: 200,
      employees_in_response: data.length,
      total_records: json.totalRecords,
      total_pages: json.totalPages
    });

    return json;

  } catch (err) {
    recordTest('HRIS Employee Search', false, {
      error: err.message
    });
    log(`  ERROR: ${err.message}`, 'error');
    return null;
  }
}

// ========== TEST 3: Attendance Ingestion (X-API-Key) ==========

async function testAttendanceIngestion() {
  log('TEST 3: Attendance Ingestion (X-API-Key)', 'info');
  
  try {
    if (!KEKA_ATTENDANCE_API_KEY) {
      throw new Error('Missing KEKA_ATTENDANCE_API_KEY');
    }

    const now = new Date();
    const timestamp = now.toISOString().split('T')[0] + 'T' + 
                      String(now.getHours()).padStart(2, '0') + ':' +
                      String(now.getMinutes()).padStart(2, '0') + ':' +
                      String(now.getSeconds()).padStart(2, '0');

    // Keka API expects logEntries to be an array (no wrapper object)
    const payload = [
      {
        DeviceIdentifier: KEKA_DEVICE_ID,
        EmployeeAttendanceNumber: 'U_TEST001',
        Timestamp: timestamp,
        Status: 0  // 0 = CLOCK_IN
      }
    ];

    log(`  POST ${KEKA_ATTENDANCE_BASE_URL}`, 'debug');
    log(`  X-API-Key: ${KEKA_ATTENDANCE_API_KEY.substring(0, 8)}...`, 'debug');
    log(`  Payload: ${JSON.stringify(payload[0], null, 2)}`.split('\n').map(l => '    ' + l).join('\n'), 'debug');

    const res = await fetch(KEKA_ATTENDANCE_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': KEKA_ATTENDANCE_API_KEY
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const json = await res.json();
    if (!json.succeeded) {
      throw new Error(`API response not succeeded: ${JSON.stringify(json.errors || [])}`);
    }

    const received = json.data?.logsReceived || 0;
    const accepted = json.data?.logsAccepted || 0;
    log(`  ✓ Logs received: ${received}, accepted: ${accepted}`, 'debug');

    recordTest('Attendance Ingestion', true, {
      status: 200,
      logs_received: received,
      logs_accepted: accepted,
      response: json.data
    });

    return json;

  } catch (err) {
    recordTest('Attendance Ingestion', false, {
      error: err.message
    });
    log(`  ERROR: ${err.message}`, 'error');
    return null;
  }
}

// ========== MAIN ==========

async function main() {
  log('========================================', 'info');
  log('Keka Integration Validation Test Suite', 'info');
  log('========================================', 'info');
  log('');

  // Test 1: OAuth
  const token = await testOAuthToken();
  log('');

  // Test 2: HRIS (if token acquired)
  if (token) {
    const hrisResult = await testHRISSearch(token);
    log('');
  }

  // Test 3: Attendance Ingestion
  const ingestResult = await testAttendanceIngestion();
  log('');

  // Summary
  const passed = results.tests.filter(t => t.passed).length;
  const total = results.tests.length;
  results.summary = {
    total_tests: total,
    passed,
    failed: total - passed,
    success_rate: `${Math.round((passed / total) * 100)}%`
  };

  log('========================================', 'info');
  log(`Summary: ${passed}/${total} tests passed (${results.summary.success_rate})`, 'info');
  log('========================================', 'info');

  // Write results to JSON file
  const resultsFile = path.join(__dirname, '..', '..', 'keka_validation_results.json');
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  log(`\nResults saved to: ${resultsFile}`, 'info');

  // Exit with appropriate code
  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
