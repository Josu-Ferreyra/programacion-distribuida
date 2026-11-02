// dotenv debe cargarse antes que cualquier módulo que lea process.env.
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "./config/database.js";
import { connectRedis, redisClient } from "./config/redis.js";
import { createSSLServer } from "./config/ssl.js";
import { createApp } from "./app.js";
import { getRaftNodeConfig } from "./config/cluster.js";
import { initRaftNode } from "./raft/index.js";
import { logger } from "./utils/logger.js";

const NODE_ID = process.argv[2] || process.env.NODE_ID;

if (!NODE_ID) {
  throw new Error(`NODE_ID is required (usage: node server.js node1)`);
}

const NODE_CONFIG = getRaftNodeConfig(NODE_ID);
logger.info(`Iniciando ${NODE_CONFIG.id}`, {
  apiUrl: NODE_CONFIG.apiUrl,
  raftUrl: NODE_CONFIG.raftUrl,
  mongoUri: NODE_CONFIG.mongoUri,
  peers: NODE_CONFIG.peers.map((peer) => peer.id),
});

await connectDB(NODE_CONFIG.mongoUri);
await connectRedis();

initRaftNode(NODE_CONFIG);

const apiServer = createSSLServer(createApp(NODE_CONFIG), NODE_CONFIG.apiPort);

async function shutdown(signal) {
  logger.info(`${signal} recibido: deteniendo ${NODE_CONFIG.id}`);
  apiServer.close();
  await Promise.allSettled([
    mongoose.disconnect(),
    redisClient.isOpen ? redisClient.quit() : Promise.resolve(),
  ]);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
