/**
 * backend/scripts/etl_keka_to_employees.js
 *
 * ETL from:
 *   keka_employee_imports.raw_payload (raw Keka JSON)
 * into:
 *   employees (structured v2.0 directory)
 *
 * Handles:
 *  - keka_id, email
 *  - department (groups[groupType = 4])
 *  - location (groups[groupType = 3])
 *  - designation (jobTitle.title)
 *  - secondary_designation (secondaryJobTitle.title)
 *  - employment_status
 *  - date_of_joining
 *  - full raw_keka_profile JSONB
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = require('pg');

console.log('DEBUG DATABASE_URL =', process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ---------- Helpers ----------

// Department / location from groups[]
// department → groupType = 4
// location   → groupType = 3
function extractFromGroups(groups, wantedType) {
  if (!Array.isArray(groups)) return null;
  const match = groups.find((g) => Number(g.groupType) === wantedType);
  return match ? String(match.title || '') || null : null;
}

// Joining date from top level
function extractJoiningDate(payload) {
  return (
    payload.joiningDate ||
    payload.dateOfJoining ||
    payload.joinedOn ||
    null
  );
}

// Employment status from top level
function extractEmploymentStatus(payload) {
  if (payload.employmentStatus !== undefined && payload.employmentStatus !== null) {
    return String(payload.employmentStatus);
  }
  return 'UNKNOWN';
}

// Primary designation from jobTitle
function extractDesignation(payload) {
  const jt = payload.jobTitle;

  // jobTitle might be an object { title, identifier } OR a plain string
  if (jt && typeof jt === 'object') {
    if (jt.title) return String(jt.title);
  } else if (typeof jt === 'string') {
    return jt;
  }

  // Fallbacks if Keka ever sends flat fields
  if (payload.designation) return String(payload.designation);
  if (payload.title) return String(payload.title);

  return null;
}

// Secondary designation from secondaryJobTitle
function extractSecondaryDesignation(payload) {
  const sjt = payload.secondaryJobTitle;

  if (!sjt) return null;

  if (typeof sjt === 'object') {
    if (sjt.title) return String(sjt.title);
  } else if (typeof sjt === 'string') {
    return sjt;
  }

  return null;
}

// ---------- Core ETL ----------

async function runETL() {
  const client = await pool.connect();

  try {
    console.log('[etl] Loading raw employees from keka_employee_imports...');
    const res = await client.query(
      'SELECT keka_employee_id, raw_payload FROM keka_employee_imports',
    );

    console.log(`[etl] Found ${res.rowCount} raw records.`);

    let created = 0;
    let updated = 0;

    for (const row of res.rows) {
      const payload = row.raw_payload || {};
      const kekaId = payload.id || row.keka_employee_id;

      const email =
        payload.email ||
        payload.personalEmail ||
        null;

      const groups = payload.groups || [];

      const designation = extractDesignation(payload);
      const secondaryDesignation = extractSecondaryDesignation(payload);
      const department = extractFromGroups(groups, 4); // groupType 4 → department
      const location = extractFromGroups(groups, 3);   // groupType 3 → location
      const employmentStatus = extractEmploymentStatus(payload);
      const dateOfJoining = extractJoiningDate(payload);

      const existing = await client.query(
        'SELECT id FROM employees WHERE keka_id = $1',
        [kekaId],
      );

      await client.query(
        `
        INSERT INTO employees (
          slack_user_id,
          keka_id,
          email,
          department,
          designation,
          secondary_designation,
          location,
          employment_status,
          date_of_joining,
          role,
          ai_profile,
          raw_keka_profile,
          updated_at
        )
        VALUES (
          NULL,
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          'EMPLOYEE',
          '{}'::jsonb,
          $9::jsonb,
          NOW()
        )
        ON CONFLICT (keka_id) DO UPDATE
        SET
          email                 = EXCLUDED.email,
          department            = EXCLUDED.department,
          designation           = EXCLUDED.designation,
          secondary_designation = EXCLUDED.secondary_designation,
          location              = EXCLUDED.location,
          employment_status     = EXCLUDED.employment_status,
          date_of_joining       = EXCLUDED.date_of_joining,
          raw_keka_profile      = EXCLUDED.raw_keka_profile,
          updated_at            = NOW()
        `,
        [
          kekaId,                   // $1
          email,                    // $2
          department,               // $3
          designation,              // $4
          secondaryDesignation,     // $5
          location,                 // $6
          employmentStatus,         // $7
          dateOfJoining,            // $8
          JSON.stringify(payload),  // $9
        ],
      );

      if (existing.rowCount > 0) {
        updated += 1;
      } else {
        created += 1;
      }

      console.log(
        `[etl] keka_id=${kekaId} | email=${email} | dept=${department} | loc=${location} | designation=${designation} | secondary=${secondaryDesignation}`,
      );
    }

    console.log('------------ ETL SUMMARY ------------');
    console.log('Created:', created);
    console.log('Updated:', updated);
    console.log('-------------------------------------');
  } catch (err) {
    console.error('[etl] ERROR:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

// ---------- Entrypoint ----------

runETL().catch((err) => {
  console.error('[etl] Top-level error:', err);
  process.exit(1);
});
