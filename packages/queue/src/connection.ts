import IORedis from "ioredis";

let sharedConnection: IORedis | undefined;

/** BullMQ requires maxRetriesPerRequest: null on the shared Redis connection. */
export function getRedisConnection(): IORedis {
  if (!sharedConnection) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error("REDIS_URL is not set");
    }
    sharedConnection = new IORedis(url, { maxRetriesPerRequest: null });
  }
  return sharedConnection;
}
