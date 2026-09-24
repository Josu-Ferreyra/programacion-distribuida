import mongoose from "mongoose";

export async function connectDB(MONGO_URI) {
  try {
    if (!MONGO_URI) {
      throw new Error("MONGO_URI doesn't provided");
    }

    await mongoose.connect(MONGO_URI);
    console.log("MongoDB connected");
  } catch (error) {
    console.error("Error connecting MongoDB:", error);
    process.exit(1);
  }
}
