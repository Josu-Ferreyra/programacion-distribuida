import mongoose from "mongoose";
import crypto from "crypto";
import { User, USER_EDITABLE_FIELDS } from "../models/user.model.js";
import { redisClient } from "../config/redis.js";
import { releaseLock } from "../utils/helpers.js";
import { getRaftNode } from "../raft/index.js";
import { COMMANDS } from "../raft/state-machine.js";

function httpError(statusCode, message, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (details) err.details = details;
  return err;
}

function assertValidId(id) {
  if (!/^[a-f0-9]{24}$/i.test(id)) {
    throw httpError(400, "Invalid user id");
  }
}

function pickEditableFields(body = {}) {
  const unexpected = Object.keys(body).filter(
    (field) => !USER_EDITABLE_FIELDS.includes(field),
  );
  if (unexpected.length > 0) {
    throw httpError(400, `Unexpected fields: ${unexpected.join(", ")}`);
  }
  return { ...body };
}

async function findExistingUser(id) {
  const user = await User.findById(id);
  if (!user) throw httpError(404, "User not found");
  return user;
}

// Las escrituras NO tocan MongoDB: se convierten en un comando, se proponen al
// log Raft y se responde recién cuando la entrada fue committed por mayoría y
// aplicada por la State Machine local del Leader.
async function replicate(command) {
  const { entry, result } = await getRaftNode().propose(command);
  const raft = { index: entry.index, term: entry.term };
  if (!result.ok) {
    throw httpError(result.status, result.error, raft);
  }
  return { data: result.data, raft };
}

export class UserService {
  // Lecturas: se resuelven localmente en el nodo que recibe la petición.
  static async getAll() {
    return await User.find();
  }

  static async getById(id) {
    assertValidId(id);
    return await User.findById(id);
  }

  static async create(userData) {
    const data = pickEditableFields(userData);
    // El identificador y la marca de tiempo se generan UNA sola vez en el
    // Leader y viajan en el comando: todas las réplicas usan los mismos.
    const id = new mongoose.Types.ObjectId().toString();
    await new User({ _id: id, ...data }).validate();

    return replicate({
      type: COMMANDS.CREATE_USER,
      id,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  static async update(id, userData) {
    assertValidId(id);
    const data = pickEditableFields(userData);
    if (Object.keys(data).length === 0) {
      throw httpError(400, "Request body is empty");
    }

    const user = await findExistingUser(id);
    user.set(data);
    await user.validate();

    return replicate({
      type: COMMANDS.UPDATE_USER,
      id,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  static async delete(id) {
    assertValidId(id);
    await findExistingUser(id);
    return replicate({ type: COMMANDS.DELETE_USER, id });
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
