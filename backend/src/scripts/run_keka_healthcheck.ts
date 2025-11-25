import { Pool } from 'pg';
import KekaService from '../services/keka/keka.service';
import { runKekaHealthCheck } from '../services/keka/kekaHealth.worker';

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const kekaService = new KekaService(pool, { apiKey: process.env.KEKA_API_KEY });
  await runKekaHealthCheck(pool, kekaService);
  await pool.end();
})();
