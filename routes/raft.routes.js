import { Router } from "express";
import { RaftController } from "../controllers/raft.controller.js";

// Endpoints de DIAGNÓSTICO (sólo lectura). Los RPC internos del protocolo no se
// exponen en esta API: viven en el servidor HTTP interno de cada nodo.
const router = Router();

/**
 * @openapi
 * /api/raft/status:
 *   get:
 *     summary: Estado Raft del nodo (identidad, rol, término, Leader conocido, índices)
 *     tags:
 *       - Raft diagnóstico
 *     responses:
 *       200:
 *         description: Información del estado del nodo
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RaftStatus'
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/status", RaftController.getStatus);

/**
 * @openapi
 * /api/raft/log:
 *   get:
 *     summary: Log Raft local con el estado de cada entrada
 *     description: >
 *       Cada entrada indica su estado visto desde este nodo: LOCAL (sólo en el Leader),
 *       REPLICATED (en algún follower, sin mayoría), UNCOMMITTED (en un follower, sin confirmar),
 *       COMMITTED (confirmada por mayoría) o APPLIED (aplicada en la State Machine local).
 *     tags:
 *       - Raft diagnóstico
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *     responses:
 *       200:
 *         description: Entradas del log local
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RaftLog'
 *       400:
 *         description: Parámetros inválidos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/log", RaftController.getLog);

export default router;
