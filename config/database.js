import mongoose from "mongoose";
import { logger } from "../utils/logger.js";

export async function connectDB(MONGO_URI) {
  try {
    if (!MONGO_URI) {
      throw new Error("MONGO_URI doesn't provided");
    }

    await mongoose.connect(MONGO_URI);
    logger.info(`MongoDB connected (${mongoose.connection.name})`);
  } catch (error) {
    logger.error("Error connecting MongoDB", { error: error.message });
    process.exit(1);
  }
}
