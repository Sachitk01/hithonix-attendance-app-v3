import express from 'express';
import { getAppPool } from '../db/pool';

const app = express();
app.use(express.json());

// Manager dashboard: returns team list for a manager_id
app.get('/manager/dashboard', async (req, res) => {
  const managerId = req.query.manager_id as string;
  if (!managerId) return res.status(400).json({ error: 'manager_id is required' });
  try {
    const pool = getAppPool();
    const q = `SELECT
      e.id as employee_id,
      e.full_name,
      e.email,
      ds.current_status,
      ds.last_event_timestamp_utc,
      ds.has_sync_errors
    FROM employee_hierarchy_v h
    JOIN employees e ON e.id = h.employee_id
    LEFT JOIN daily_status ds
      ON ds.employee_id = e.id
      AND ds.business_date_ist = (now() AT TIME ZONE 'Asia/Kolkata')::date
    WHERE h.manager_id = $1
    ORDER BY (ds.has_sync_errors::int) DESC, (ds.current_status = 'LOCKED')::int DESC, (ds.current_status = 'LATE')::int DESC, e.full_name ASC`;
    const r = await pool.query(q, [managerId]);
    return res.json(r.rows);
  } catch (err:any) {
    console.error('manager/dashboard error', err);
    return res.status(500).json({ error: err.message || 'internal' });
  }
});

// Timeline: return attendance events for an employee on a date
app.get('/manager/timeline', async (req, res) => {
  const employeeId = req.query.employee_id as string;
  const date = req.query.date as string;
  if (!employeeId || !date) return res.status(400).json({ error: 'employee_id and date are required (YYYY-MM-DD)' });
  try {
    const pool = getAppPool();
    const q = `SELECT * FROM attendance_events WHERE employee_id = $1 AND business_date_ist = $2::date ORDER BY event_timestamp_utc ASC`;
    const r = await pool.query(q, [employeeId, date]);
    return res.json(r.rows);
  } catch (err:any) {
    console.error('manager/timeline error', err);
    return res.status(500).json({ error: err.message || 'internal' });
  }
});

if (require.main === module) {
  const port = Number(process.env.MANAGER_API_PORT || 3001);
  app.listen(port, () => console.log(`Manager API listening on ${port}`));
}

export default app;
