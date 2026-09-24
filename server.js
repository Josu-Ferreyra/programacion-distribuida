import dotenv from "dotenv";
import { connectDB } from "./config/database.js";
import { connectRedis } from "./config/redis.js";
import { createSSLServer } from "./config/ssl.js";
import { app } from "./app.js";
import { getRaftNodeConfig } from "./config/raft.js";
import { RaftNode } from "./services/raft.service.js";

dotenv.config();

const NODE_ID = process.argv[2];

if (!NODE_ID) {
  throw new Error(`NODE_ID is required`);
}

const NODE_CONFIG = getRaftNodeConfig(NODE_ID);
export const NODE = new RaftNode(NODE_CONFIG);

await connectDB(NODE_CONFIG.mongoUri);
await connectRedis();
createSSLServer(app, NODE_CONFIG.port);
