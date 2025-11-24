import axios, { AxiosInstance } from 'axios';
import type { Pool } from 'pg';

export type KekaSearchResult = any;

export class KekaService {
  private http: AxiosInstance;
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
  }

  // Search employees by workEmail
  async searchByEmail(email: string) {
    const url = `/hris/employees/search`;
    const payload = { search_by: 'workEmail', search_value: email };
    const res = await this.http.post(url, payload);
    return res.data as KekaSearchResult;
  }

  // Push attendance ingestion to Keka
  async pushAttendance(employeeAttendanceNumber: string, payload: Record<string, any>) {
    const url = `/v1/logs`;
    const body = { EmployeeAttendanceNumber: employeeAttendanceNumber, ...payload };
    const res = await this.http.post(url, body);
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
