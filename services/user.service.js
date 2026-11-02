import mongoose from "mongoose";
import crypto from "crypto";
import { User, USER_EDITABLE_FIELDS } from "../models/user.model.js";
import { redisClient } from "../config/redis.js";
import { delay, releaseLock } from "../utils/helpers.js";
import { getRaftNode } from "../raft/index.js";
import { COMMANDS } from "../raft/state-machine.js";

const LOCK_TTL_MS = Number(process.env.SAVINGS_LOCK_TTL_MS || 10000);
const CRITICAL_SECTION_DELAY_MS = Number(
  process.env.SAVINGS_CRITICAL_SECTION_DELAY_MS || 0,
);

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

  // Integración TP2 + Raft:
  //  - Redis decide QUIÉN entra a la sección crítica (lock distribuido).
  //  - Raft decide CÓMO se ordena, replica y confirma la modificación aceptada.
  // El lock se libera recién cuando la entrada fue committed y aplicada, así la
  // siguiente operación lee el saldo ya actualizado.
  static async updateSavings(userId, amount) {
    assertValidId(userId);
    if (!redisClient.isReady) {
      throw httpError(503, "Redis is not available: distributed lock cannot be acquired");
    }

    const lockKey = `lock:users:${userId}:savings`;
    const lockValue = crypto.randomUUID();

    const acquired = await redisClient.set(lockKey, lockValue, {
      NX: true,
      PX: LOCK_TTL_MS,
    });

    if (!acquired) {
      throw httpError(409, "Could not acquire lock for user savings update");
    }

    try {
      await getRaftNode().waitUntilLeaderIsUpToDate();
      const user = await findExistingUser(userId);

      const newSavings = user.savings + amount;
      if (newSavings < 0) {
        throw httpError(400, "Insufficient savings");
      }

      // Retardo opcional para que la exclusión mutua sea observable.
      if (CRITICAL_SECTION_DELAY_MS > 0) await delay(CRITICAL_SECTION_DELAY_MS);

      return await replicate({
        type: COMMANDS.SET_SAVINGS,
        id: userId,
        savings: newSavings,
        amount,
        timestamp: new Date().toISOString(),
      });
    } finally {
      await releaseLock(redisClient, lockKey, lockValue);
    }
  }
}
