import { getRaftNode } from "../raft/index.js";
import { NotLeaderError } from "../raft/errors.js";
import { logger } from "../utils/logger.js";

// Decisión de diseño: una escritura recibida por un follower se RECHAZA sin
// aplicarse ni proponerse, informando cuál es el Leader (421 + X-Raft-Leader).
// Si no hay Leader conocido se responde 503 para que el cliente reintente.
export const requireLeader = (req, res, next) => {
  const node = getRaftNode();
  if (node.isLeader) return next();

  logger.warn(`Escritura rechazada: ${node.id} es ${node.role}`, {
    method: req.method,
    url: req.originalUrl,
    leaderId: node.leaderId,
  });
  next(new NotLeaderError(node));
};
