import express from "express";
import { logger } from "../utils/logger.js";

// Servidor HTTP interno del protocolo. Escucha en un puerto distinto de la API
// HTTPS de negocio y sólo expone los RPC de Raft.
export function startRaftRpcServer(raftNode, nodeConfig) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  /**
   * @openapi
   * /raft/request-vote:
   *   post:
   *     summary: "[RPC interno] RequestVote: un candidato solicita el voto"
   *     description: >
   *       RPC interno del protocolo Raft, servido por HTTP en el puerto interno del nodo
   *       (4001-4003), NO en la API HTTPS. No debe usarse como mecanismo de prueba de negocio.
   *     tags:
   *       - Raft RPC interno
   *     servers:
   *       - url: http://127.0.0.1:4001
   *       - url: http://127.0.0.1:4002
   *       - url: http://127.0.0.1:4003
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/RequestVoteRequest'
   *     responses:
   *       200:
   *         description: Respuesta del votante
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/RequestVoteResponse'
   */
  app.post("/raft/request-vote", async (req, res, next) => {
    try {
      res.json(await raftNode.handleRequestVote(req.body));
    } catch (error) {
      next(error);
    }
  });

  app.use((err, req, res, next) => {
    logger.error(`Error en RPC interno ${req.originalUrl}`, { error: err.message });
    res.status(500).json({ error: err.message });
  });

  const host = process.env.RAFT_BIND_HOST || "127.0.0.1";
  return app.listen(nodeConfig.raftPort, host, () => {
    logger.info(`RPC interno Raft escuchando en http://${host}:${nodeConfig.raftPort}`);
  });
}
