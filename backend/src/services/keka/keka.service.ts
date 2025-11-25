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
      // HRIS base (tenant-specific). Use the computed KEKA_HRIS_BASE so relative HRIS paths are correct.
      baseURL: opts.baseUrl ?? KekaService.KEKA_HRIS_BASE,
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        accept: 'application/json'
      }
    });
    // Separate axios instance for Keka attendance ingestion API
    // KEKA_ATTENDANCE_BASE_URL is expected to include the full path (https://cin03.a.keka.com/v1/logs)
    this.attendanceHttp = axios.create({
      // attendance base should be a full URL to the ingestion endpoint (including /v1/logs).
      // We'll post to the base (empty path) to avoid duplicating segments.
      baseURL: process.env.KEKA_ATTENDANCE_BASE_URL || 'https://cin03.a.keka.com/v1/logs',
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        // Explicitly use the attendance API key env var for ingestion.
        'X-API-Key': process.env.KEKA_ATTENDANCE_API_KEY
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

  // Obtain OAuth token from Keka using kekaapi grant (API key-based)
  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache.token && this.tokenCache.expiresAt && this.tokenCache.expiresAt > now + 5000) {
      return this.tokenCache.token as string;
    }

    const tokenEndpoint = process.env.KEKA_AUTH_URL;
    if (!tokenEndpoint) throw new Error('KEKA_AUTH_URL is not set');
    const clientId = process.env.KEKA_CLIENT_ID;
    const clientSecret = process.env.KEKA_CLIENT_SECRET;
    const apiKey = process.env.KEKA_API_KEY;
    if (!clientId || !clientSecret || !apiKey) throw new Error('KEKA client credentials and API key not set');

    const body = qs.stringify({
      grant_type: 'kekaapi',
      scope: process.env.KEKA_SCOPE || 'kekaapi',
      client_id: clientId,
      client_secret: clientSecret,
      api_key: apiKey
    });

    const resp = await axios.post(tokenEndpoint, body, { 
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded',
        accept: 'application/json'
      } 
    });
    const data = resp.data;
    if (!data || !data.access_token) throw new Error('failed to obtain keka access token');
    const expiresIn = data.expires_in || 3600;
    this.tokenCache.token = data.access_token;
    this.tokenCache.expiresAt = Date.now() + (expiresIn * 1000);
    return this.tokenCache.token as string;
  }

  // Search employees by workEmail
  async searchByEmail(email: string) {
    // Get a fresh or cached access token for HRIS access
    const token = await this.getAccessToken();
    
    // KEKA_HRIS_BASE already includes the /api/v1/hris segment; the employees search endpoint is /employees/search
    const url = `/employees/search`;
    const payload = { search_by: 'workEmail', search_value: email };
    
    // Make request with Bearer token in Authorization header
    const res = await this.http.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    return res.data as KekaSearchResult;
  }

  // Push attendance ingestion to Keka (attendance log API)
  // Expects payload: { deviceId, employeeAttendanceNumber, timestamp, status }
  // where status: 0 = IN, 1 = OUT, 2 = BREAK_START, 3 = BREAK_END (or your defined codes)
  async pushAttendance(payload: { deviceId: string; employeeAttendanceNumber: string; timestamp: string; status: number }) {
    // Post directly to the configured attendance base URL. The env variable is expected to include the full path
    // (e.g. https://cin03.a.keka.com/v1/logs). To avoid double-path issues we post to '' (the base).
    // Keka ingestion API expects an array of log objects (simple array, not wrapped)
    const body = [
      {
        DeviceIdentifier: payload.deviceId,
        EmployeeAttendanceNumber: payload.employeeAttendanceNumber,
        Timestamp: payload.timestamp, // "YYYY-MM-DDTHH:MM:SS" format, no timezone offset
        Status: payload.status,
      },
    ];
    const res = await this.attendanceHttp.post('', body);
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
