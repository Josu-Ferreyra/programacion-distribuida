import { createClient } from "redis";
import { logger } from "../utils/logger.js";

// Redis se usa SÓLO para el lock distribuido heredado del TP2. No participa en
// la elección de Leader, votos, quorum ni commit: si no está disponible, el
// cluster Raft sigue funcionando y sólo falla el endpoint de ahorros.
export const redisClient = createClient({
  url: process.env.REDIS_URL,
  socket: { reconnectStrategy: (retries) => Math.min(retries * 500, 5000) },
});

let lastErrorLoggedAt = 0;
redisClient.on("error", (err) => {
  if (Date.now() - lastErrorLoggedAt > 30000) {
    lastErrorLoggedAt = Date.now();
    logger.warn("Redis Client Error", { error: err.message });
  }
});

export async function connectRedis() {
  try {
    await redisClient.connect();
    logger.info("Redis client connected successfully");
  } catch (error) {
    logger.warn("Redis no disponible: el lock de ahorros quedará deshabilitado", {
      error: error.message,
    });
  }
}
