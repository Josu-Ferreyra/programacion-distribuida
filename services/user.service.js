import { User } from "../models/user.model.js";
import { redisClient } from "../config/redis.js";
import { releaseLock } from "../utils/helpers.js";
import crypto from "crypto";

export class UserService {
  static async getAll() {
    return await User.find();
  }

  static async getById(id) {
    return await User.findById(id);
  }

  static async create(userData) {
    return await User.create(userData);
  }

  static async update(id, userData) {
    return await User.findByIdAndUpdate(id, userData, {
      new: true,
      runValidators: true,
    });
  }

  static async delete(id) {
    return await User.findByIdAndDelete(id);
  }

  static async updateSavings(userId, amount) {
    const lockKey = `lock:users:${userId}:savings`;
    const lockValue = crypto.randomUUID();

    const acquired = await redisClient.set(lockKey, lockValue, {
      NX: true,
      PX: 6000,
    });

    if (!acquired) {
      const err = new Error("Could not acquire lock for user savings update");
      err.statusCode = 409;
      throw err;
    }

    try {
      const user = await User.findById(userId).select("savings");
      if (!user) {
        const err = new Error("User not found");
        err.statusCode = 404;
        throw err;
      }

      const newSavings = user.savings + amount;
      await User.findByIdAndUpdate(userId, { savings: newSavings });
      return newSavings;
    } finally {
      await releaseLock(redisClient, lockKey, lockValue);
    }
  }
}
