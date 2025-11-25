import { RedisOptions } from 'ioredis';

// Export a RedisOptions object so calling code can do: new Queue(name, { connection })
export const connection: RedisOptions = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
};

export default connection;
