import axios, { AxiosInstance } from 'axios';
import type { Pool } from 'pg';
// Note: keep Pool imported as a type-only import
import qs from 'querystring';

export type KekaSearchResult = any;

export class KekaService {
  private http: AxiosInstance;
  private attendanceHttp: AxiosInstance;
  private pool: Pool;
  private tokenCache: { token?: string | undefined; expiresAt?: number | undefined } = {};
  constructor(pool: Pool, opts: { baseUrl?: string; apiKey: string; tenantAlias?: string; clientId?: string; clientSecret?: string; }) {
    this.pool = pool;
    this.http = axios.create({
      // HRIS base (used for auth/token exchange only as an axios instance placeholder)
      baseURL: opts.baseUrl ?? (process.env.KEKA_ENV_DOMAIN ? `https://${process.env.KEKA_COMPANY_ALIAS}.${process.env.KEKA_ENV_DOMAIN}` : 'https://keka.com'),
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': opts.apiKey ?? process.env.KEKA_API_KEY
      }
    });
    // Separate axios instance for Keka attendance ingestion API
    // KEKA_ATTENDANCE_BASE_URL is expected to include the full path (https://cin03.a.keka.com/v1/logs)
    this.attendanceHttp = axios.create({
      baseURL: process.env.KEKA_ATTENDANCE_BASE_URL || 'https://cin03.a.keka.com/v1/logs',
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': opts.apiKey ?? process.env.KEKA_ATTENDANCE_API_KEY
      }
    });
  }

  // Computed HRIS base and search URL (tenant-specific)
  static get KEKA_HRIS_BASE() {
    return `https://${process.env.KEKA_COMPANY_ALIAS}.${process.env.KEKA_ENV_DOMAIN}/api/v1/hris`;
  }

  static get KEKA_EMPLOYEE_SEARCH_URL() {
    return `${KekaService.KEKA_HRIS_BASE}/employees/search`;
  }

  // Obtain OAuth token from Keka (client credentials grant)
  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache.token && this.tokenCache.expiresAt && this.tokenCache.expiresAt > now + 5000) {
      return this.tokenCache.token as string;
    }

    const tokenEndpoint = process.env.KEKA_AUTH_URL;
    if (!tokenEndpoint) throw new Error('KEKA_AUTH_URL is not set');
    const clientId = process.env.KEKA_CLIENT_ID;
    const clientSecret = process.env.KEKA_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('KEKA client credentials not set');

    const body = qs.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      scope: process.env.KEKA_SCOPE || 'kekaapi',
      grant_type: 'client_credentials'
    });

    const resp = await axios.post(tokenEndpoint, body, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const data = resp.data;
    if (!data || !data.access_token) throw new Error('failed to obtain keka access token');
    const expiresIn = data.expires_in || 3600;
    this.tokenCache.token = data.access_token;
    this.tokenCache.expiresAt = Date.now() + (expiresIn * 1000);
    return this.tokenCache.token;
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
