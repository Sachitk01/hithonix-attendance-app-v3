/**
 * backend/scripts/etl_manager_mapping.js
 *
 * Populate employees.manager_employee_id using Keka manager fields.
 *
 * Hithonix-specific precedence (aligned to Keka UI):
 *   1) reportsTo          → Primary Reporting Manager (as seen in UI)
 *   2) dottedLineManager  → Dotted-line manager (secondary)
 *   3) l2Manager          → L2 / escalation manager (tertiary)
 *
 * Resolution strategy:
 *   - Prefer manager.id       → employees.keka_id
 *   - Fallback manager.email  → employees.email (case-insensitive)
 *
 * Behaviour:
 *   - Idempotent: safe to run multiple times.
 *   - Only updates manager_employee_id when a resolvable manager is found
 *     and it differs from the existing value.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = require('pg');

console.log('DEBUG DATABASE_URL =', process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ---------- Helper: pick manager object according to org precedence ----------

/**
 * Selects the manager object from raw Keka payload using tenant-specific
 * precedence:
 *   reportsTo → dottedLineManager → l2Manager
 *
 * Returns:
 *   { id, email, firstName, lastName } | null
 */
function pickManagerObject(payload) {
  if (!payload || typeof payload !== 'object') return null;

  // Precedence for Hithonix:
  //   reportsTo (Reporting) → dottedLineManager → l2Manager
  const candidates = [
    payload.reportsTo,
    payload.dottedLineManager,
    payload.l2Manager,
  ];

  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;

    const rawId = c.id;
    const rawEmail = c.email;

    const hasId =
      rawId !== null &&
      rawId !== undefined &&
      String(rawId).trim() !== '';

    const hasEmail =
      rawEmail &&
      String(rawEmail).trim() !== '';

    if (hasId || hasEmail) {
      return {
        id: hasId ? String(rawId).trim() : null,
        email: hasEmail ? String(rawEmail).trim() : null,
        firstName: c.firstName || null,
        lastName: c.lastName || null,
      };
    }
  }

  return null;
}

// ---------- Core manager ETL ----------

async function runManagerETL() {
  const client = await pool.connect();

  let updated = 0;
  let unchanged = 0;
  let noManager = 0;
  let managerNotFound = 0;
  let selfManager = 0;

  try {
    console.log('[manager-etl] Loading employees joined with Keka payloads...');

    // Join employees to their raw Keka import (by keka_id)
    const res = await client.query(`
      SELECT
        e.id          AS employee_id,
        e.keka_id     AS employee_keka_id,
        e.email       AS employee_email,
        e.manager_employee_id,
        k.raw_payload AS raw_payload
      FROM employees e
      JOIN keka_employee_imports k
        ON k.keka_employee_id = e.keka_id
    `);

    console.log(`[manager-etl] Processing ${res.rowCount} employees...`);

    await client.query('BEGIN');

    for (const row of res.rows) {
      const employeeId = row.employee_id;
      const employeeKekaId = row.employee_keka_id;
      const employeeEmail = row.employee_email;
      const existingManagerId = row.manager_employee_id;
      const payload = row.raw_payload || {};

      const manager = pickManagerObject(payload);

      if (!manager) {
        noManager += 1;
        continue;
      }

      const managerKekaId = manager.id;
      const managerEmail = manager.email;

      let managerRow = null;

      // 1) Resolve by manager Keka ID
      if (managerKekaId) {
        const mgrById = await client.query(
          'SELECT id, email FROM employees WHERE keka_id = $1',
          [managerKekaId],
        );
        if (mgrById.rowCount === 1) {
          managerRow = mgrById.rows[0];
        }
      }

      // 2) Fallback: resolve by manager email
      if (!managerRow && managerEmail) {
        const mgrByEmail = await client.query(
          'SELECT id, email FROM employees WHERE lower(email) = lower($1)',
          [managerEmail],
        );
        if (mgrByEmail.rowCount === 1) {
          managerRow = mgrByEmail.rows[0];
        }
      }

      if (!managerRow) {
        managerNotFound += 1;
        console.warn(
          `[manager-etl] Manager not found for employee=${employeeEmail} (employeeKekaId=${employeeKekaId}) ` +
            `(managerKekaId=${managerKekaId || 'NULL'}, managerEmail=${managerEmail || 'NULL'})`,
        );
        continue;
      }

      const newManagerId = managerRow.id;

      // Guardrail: avoid self-referential managers
      if (newManagerId === employeeId) {
        selfManager += 1;
        console.warn(
          `[manager-etl] Skipping self-manager mapping for employee=${employeeEmail} (keka_id=${employeeKekaId})`,
        );
        continue;
      }

      // No-op if nothing actually changes
      if (existingManagerId === newManagerId) {
        unchanged += 1;
        continue;
      }

      await client.query(
        `
        UPDATE employees
        SET manager_employee_id = $1,
            updated_at          = NOW()
        WHERE id = $2
        `,
        [newManagerId, employeeId],
      );

      updated += 1;

      console.log(
        `[manager-etl] employee=${employeeEmail} (keka_id=${employeeKekaId}) ` +
          `→ managerEmployeeId=${newManagerId} (resolved from managerKekaId=${managerKekaId || 'NULL'}, email=${managerEmail || 'NULL'})`,
      );
    }

    await client.query('COMMIT');

    console.log('------------ MANAGER ETL SUMMARY ------------');
    console.log('Updated manager_employee_id  :', updated);
    console.log('Unchanged (already correct)  :', unchanged);
    console.log('Employees with no manager    :', noManager);
    console.log('Managers not resolvable      :', managerNotFound);
    console.log('Self-manager mappings skipped:', selfManager);
    console.log('---------------------------------------------');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[manager-etl] ERROR:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

// ---------- Entrypoint ----------

runManagerETL().catch((err) => {
  console.error('[manager-etl] Top-level error:', err);
  process.exit(1);
});
