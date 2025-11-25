/**
 * backend/scripts/fetch_keka_employees.js
 *
 * Script to:
 *  - Get OAuth token from Keka
 *  - Page through /api/v1/hris/employees
 *  - Upsert raw payloads into keka_employee_imports
 *
 * Run from project root:
 *   node backend/scripts/fetch_keka_employees.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
console.log('DEBUG DATABASE_URL =', process.env.DATABASE_URL);

const { Pool } = require('pg');

// ---------- Config helpers ----------

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[config] Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

// Core env wiring
const DATABASE_URL = requireEnv('DATABASE_URL');
const KEKA_CLIENT_ID = requireEnv('KEKA_CLIENT_ID');
const KEKA_CLIENT_SECRET = requireEnv('KEKA_CLIENT_SECRET');
const KEKA_API_KEY = requireEnv('KEKA_API_KEY');
const KEKA_COMPANY_ALIAS = requireEnv('KEKA_COMPANY_ALIAS'); // e.g. "hithonix"

// Optional envs with defaults
const KEKA_ENV_DOMAIN = process.env.KEKA_ENV_DOMAIN || 'keka.com';
const KEKA_SCOPE = process.env.KEKA_SCOPE || 'kekaapi';
const KEKA_AUTH_URL =
  process.env.KEKA_AUTH_URL || 'https://login.keka.com/connect/token';

// e.g. https://hithonix.keka.com/api/v1/hris
const KEKA_HRIS_BASE = `https://${KEKA_COMPANY_ALIAS}.${KEKA_ENV_DOMAIN}/api/v1/hris`;

// ---------- DB pool ----------

const pool = new Pool({
  connectionString: DATABASE_URL,
});

// ---------- Keka auth ----------

async function getAccessToken() {
  console.log('[keka] Requesting access token...');

  const body = new URLSearchParams();
  body.append('grant_type', 'kekaapi');
  body.append('scope', KEKA_SCOPE);
  body.append('client_id', KEKA_CLIENT_ID);
  body.append('client_secret', KEKA_CLIENT_SECRET);
  body.append('api_key', KEKA_API_KEY);

  const res = await fetch(KEKA_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `[keka] Failed to get token: HTTP ${res.status} ${res.statusText} – ${text}`,
    );
  }

  const json = await res.json();
  if (!json.access_token) {
    throw new Error('[keka] No access_token in response payload');
  }

  console.log('[keka] Access token acquired.');
  return json.access_token;
}

// ---------- Keka employees fetch (paged) ----------

async function fetchEmployeesPage(accessToken, pageNumber) {
  const url = new URL('employees', KEKA_HRIS_BASE);

  url.searchParams.set('inProbation', 'false');
  url.searchParams.set('inNoticePeriod', 'false');
  url.searchParams.set('pageNumber', String(pageNumber));
  url.searchParams.set('pageSize', '200'); // max 200

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `[keka] Failed to fetch employees page=${pageNumber}: HTTP ${res.status} ${res.statusText} – ${text}`,
    );
  }

  const json = await res.json();

  if (!json.succeeded) {
    throw new Error(
      `[keka] API marked response as not succeeded for page=${pageNumber}: ${JSON.stringify(
        json.errors || [],
      )}`,
    );
  }

  const data = json.data || [];
  const totalPages = json.totalPages || 1;
  const totalRecords = json.totalRecords || data.length;

  return { data, totalPages, totalRecords };
}

// ---------- DB upsert ----------

async function upsertKekaEmployeeImport(client, employee) {
  const kekaEmployeeId = employee.id;
  if (!kekaEmployeeId) {
    console.warn('[keka] Employee without id encountered, skipping');
    return;
  }

  const rawPayload = JSON.stringify(employee);

  await client.query(
    `
      INSERT INTO keka_employee_imports (keka_employee_id, raw_payload)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (keka_employee_id) DO UPDATE
      SET raw_payload = EXCLUDED.raw_payload,
          fetched_at  = NOW()
    `,
    [kekaEmployeeId, rawPayload],
  );
}

// ---------- Main orchestrator ----------

async function main() {
  const client = await pool.connect();

  try {
    const accessToken = await getAccessToken();

    let pageNumber = 1;
    let totalPages = 1;
    let grandTotalSeen = 0;

    console.log('[keka] Starting paged fetch from /api/v1/hris/employees...');

    while (pageNumber <= totalPages) {
      console.log(`[keka] Fetching page ${pageNumber} of ${totalPages}...`);

      const { data, totalPages: apiTotalPages, totalRecords } =
        await fetchEmployeesPage(accessToken, pageNumber);

      if (pageNumber === 1) {
        totalPages = apiTotalPages || 1;
        console.log(
          `[keka] Keka reports totalRecords=${totalRecords}, totalPages=${totalPages}`,
        );
      }

      console.log(
        `[keka] Page ${pageNumber}: received ${data.length} employees`,
      );

      await client.query('BEGIN');
      try {
        for (const emp of data) {
          await upsertKekaEmployeeImport(client, emp);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }

      grandTotalSeen += data.length;
      pageNumber += 1;
    }

    console.log(
      `[keka] Completed sync. Total employees processed this run: ${grandTotalSeen}`,
    );
    console.log(
      '[keka] Sanity check:\n  SELECT keka_employee_id, raw_payload->>\'email\' FROM keka_employee_imports LIMIT 10;',
    );
  } catch (err) {
    console.error('[fatal] Unhandled error in Keka sync:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[fatal] Top-level error:', err);
  process.exit(1);
});
