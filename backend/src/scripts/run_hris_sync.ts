import { Pool } from 'pg';
import KekaService from '../services/keka/keka.service';
import { runHrisSync } from '../services/keka/hrisSync.worker';

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const kekaService = new KekaService(pool, { apiKey: process.env.KEKA_API_KEY });
  await runHrisSync(pool, kekaService);
  await pool.end();
})();
