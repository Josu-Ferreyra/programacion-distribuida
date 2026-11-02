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

export default router;
