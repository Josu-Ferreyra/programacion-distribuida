import { createClient } from "redis";
import { releaseLock } from "./utils/helpers.js";
import {
  validateBodyExists,
  validateExpectedFields,
  validateRequiredFields,
} from "./utils/validations.js";
import dotenv from "dotenv";
import express from "express";
import fs from "fs";
import https from "https";
import mongoose from "mongoose";
import { User } from "./models/user.model.js";
import { logger } from "./utils/logger.js";

dotenv.config();

try {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("🍃 MongoDB connected");
} catch (error) {
  console.error("❌ Error connecting MongoDB:", error);
  process.exit(1);
}

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on("error", (err) => console.log("Redis Client Error", err));

await redisClient.connect();

console.log("Redis client connected successfully");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const httpConfig = {
  key: fs.readFileSync(process.env.SSL_KEY_PATH),
  cert: fs.readFileSync(process.env.SSL_CERT_PATH),
};

app.use((req, res, next) => {
  logger.info(`Solicitud entrante: ${req.method} ${req.originalUrl}`, {
    ip: req.ip,
  });
  next();
});

// Routes
app.get("/api/users", async (req, res) => {
  const users = await User.find();
  res.status(200).json(users);
});

app.get("/api/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json(user);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/users", async (req, res) => {
  if (!req.body) {
    return res.status(400).json({ error: "Request body is missing" });
  }

  try {
    validateBodyExists(req.body);
    validateRequiredFields(req.body);
    validateExpectedFields(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const newUser = {
    name: req.body.name,
    lastName: req.body.lastName,
    age: req.body.age,
    profession: req.body.profession,
    nativeLanguage: req.body.nativeLanguage,
    country: req.body.country,
    yearsOfExperience: req.body.yearsOfExperience,
  };

  try {
    await User.create(newUser);
    res.status(201).json(newUser);
  } catch (error) {
    return res.status(500).json({ error: "Error creating user in database" });
  }
});

app.put("/api/users/:id", async (req, res) => {
  try {
    validateBodyExists(req.body);
    validateExpectedFields(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const updatedUser = await User.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json(updatedUser);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete("/api/users/:id", async (req, res) => {
  try {
    const deletedUser = await User.findByIdAndDelete(req.params.id);
    res.status(204).json(deletedUser);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/users/:id/savings", async (req, res) => {
  const { amount } = req.body;
  if (typeof amount !== "number") {
    return res.status(400).json({ error: "Amount must be a number" });
  }

  const lockKey = `lock:users:${req.params.id}:savings`;
  const lockValue = crypto.randomUUID();

  const acquired = await redisClient.set(lockKey, lockValue, {
    NX: true,
    PX: 6000,
  });

  if (!acquired) {
    return res.status(409).json({
      error:
        "Could not acquire lock for user savings update. Please try again later.",
    });
  }

  try {
    const currentSavings = await User.findById(req.params.id).select("savings");

    await User.findByIdAndUpdate(req.params.id, {
      savings: currentSavings.savings + amount,
    });

    res.status(200).json({
      message: "Savings updated successfully",
      savings: currentSavings.savings + amount,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Internal server error" });
  } finally {
    await releaseLock(redisClient, lockKey, lockValue);
  }
});

app.use((err, req, res, next) => {
  logger.error(`Error en la operación: ${err.message}`, {
    method: req.method,
    url: req.originalUrl,
    stack: err.stack,
  });

  res.status(500).json({ error: "Error interno del servidor" });
});

https.createServer(httpConfig, app).listen(PORT, () => {
  console.log(`Server is running on https://localhost:${PORT}`);
});
