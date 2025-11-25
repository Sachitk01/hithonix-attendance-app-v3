import { RedisOptions } from 'ioredis';

export const connection = {
  connection: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  } as RedisOptions,
};

export default connection;
