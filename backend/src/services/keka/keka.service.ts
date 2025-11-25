import axios, { AxiosInstance } from 'axios';
import type { Pool } from 'pg';

export type KekaSearchResult = any;

export class KekaService {
  private http: AxiosInstance;
  private attendanceHttp: AxiosInstance;
  private pool: Pool;
  constructor(pool: Pool, opts: { baseUrl?: string; apiKey: string; tenantAlias?: string; clientId?: string; clientSecret?: string; }) {
    this.pool = pool;
    this.http = axios.create({
      baseURL: opts.baseUrl ?? (process.env.KEKA_ENV_DOMAIN ? `https://${process.env.KEKA_COMPANY_ALIAS}.${process.env.KEKA_ENV_DOMAIN}` : 'https://keka.com'),
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': opts.apiKey ?? process.env.KEKA_API_KEY
      }
    });
    // Separate axios instance for Keka attendance ingestion API
    this.attendanceHttp = axios.create({
      baseURL: process.env.KEKA_ATTENDANCE_BASE_URL || 'https://cin03.a.keka.com',
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': opts.apiKey ?? process.env.KEKA_API_KEY
      }
    });
  }

  // Search employees by workEmail
  async searchByEmail(email: string) {
    const url = `/hris/employees/search`;
    const payload = { search_by: 'workEmail', search_value: email };
    const res = await this.http.post(url, payload);
    return res.data as KekaSearchResult;
  }

  // Push attendance ingestion to Keka (attendance log API)
  // Expects payload: { deviceId, employeeAttendanceNumber, timestamp, status }
  // where status: 0 = IN, 1 = OUT, 2 = BREAK_START, 3 = BREAK_END (or your defined codes)
  async pushAttendance(payload: { deviceId: string; employeeAttendanceNumber: string; timestamp: string; status: number }) {
    const url = `/v1/logs`;
    // Keka ingestion API expects an array of log objects
    const body = [
      {
        DeviceIdentifier: payload.deviceId,
        EmployeeAttendanceNumber: payload.employeeAttendanceNumber,
        Timestamp: payload.timestamp, // "YYYY-MM-DDTHH:MM:SS" format, no timezone offset
        Status: payload.status,
      },
    ];
    const res = await this.attendanceHttp.post(url, body);
    return res.data;
  }

  // Optional helper to persist raw import payload into keka_employee_imports
  async persistImport(raw: any) {
    const q = `INSERT INTO keka_employee_imports (payload, created_at) VALUES ($1, now()) RETURNING id`;
    const r = await this.pool.query(q, [raw]);
    return r.rows[0];
  }
}

export default KekaService;
