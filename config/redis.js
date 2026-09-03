import { createClient } from "redis";

export const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on("error", (err) => console.log("Redis Client Error", err));

export async function connectRedis() {
  await redisClient.connect();
  console.log("Redis client connected successfully");
}
