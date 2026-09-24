import { Router } from "express";
import { RaftController } from "../controllers/raft.controller.js";

const router = Router();

/**
 * @openapi
 * /api/raft/status:
 *   get:
 *     summary: Obtiene el estado del nodo
 *     tags:
 *       - Raft
 *     responses:
 *       200:
 *         description: Información del estado del nodo
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/status", RaftController.getStatus);

export default router;
