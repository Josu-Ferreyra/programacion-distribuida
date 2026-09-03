import dotenv from "dotenv";
import { connectDB } from "./config/database.js";
import { connectRedis } from "./config/redis.js";
import { createSSLServer } from "./config/ssl.js";
import { app } from "./app.js";

dotenv.config();

await connectDB();
await connectRedis();
createSSLServer(app);
