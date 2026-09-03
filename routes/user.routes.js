import { Router } from "express";
import { UserController } from "../controllers/user.controller.js";

const router = Router();

/**
 * @openapi
 * /api/users:
 *   get:
 *     summary: Obtiene la lista completa de usuarios
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Lista de usuarios recuperada con éxito
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/", UserController.getAll);
/**
 * @openapi
 * /api/users/{id}:
 *   get:
 *     summary: Obtiene un usuario específico por su ID
 *     tags:
 *       - Users
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Identificador único (_id) de MongoDB
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Usuario encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       404:
 *         description: Usuario no encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/:id", UserController.getById);
/**
 * @openapi
 * /api/users:
 *   post:
 *     summary: Crea un nuevo usuario
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserInput'
 *     responses:
 *       201:
 *         description: Usuario creado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Datos de entrada inválidos o campos requeridos faltantes
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Error al persistir el usuario en la base de datos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/", UserController.create);
/**
 * @openapi
 * /api/users/{id}:
 *   put:
 *     summary: Actualiza los datos de un usuario existente
 *     tags:
 *       - Users
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Identificador único (_id) del usuario
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserInput'
 *     responses:
 *       200:
 *         description: Usuario actualizado con éxito
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Datos inválidos en el cuerpo de la petición
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Usuario no encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.put("/:id", UserController.update);
/**
 * @openapi
 * /api/users/{id}:
 *   delete:
 *     summary: Elimina un usuario por su ID
 *     tags:
 *       - Users
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Identificador único (_id) del usuario a eliminar
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Usuario eliminado exitosamente (sin contenido retornado)
 *       500:
 *         description: Error al procesar la eliminación
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.delete("/:id", UserController.delete);
/**
 * @openapi
 * /api/users/{id}/savings:
 *   post:
 *     summary: Actualiza los ahorros de un usuario aplicando exclusión mutua mediante lock en Redis
 *     tags:
 *       - Savings
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID de MongoDB del usuario cuyos ahorros se actualizarán
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: number
 *                 description: Monto a sumar a los ahorros actuales
 *                 example: 500
 *     responses:
 *       200:
 *         description: Ahorros actualizados satisfactoriamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Savings updated successfully
 *                 savings:
 *                   type: number
 *                   example: 2000
 *       400:
 *         description: El campo amount no fue enviado o no es numérico
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Conflicto de concurrencia - el recurso se encuentra bloqueado por otra operación en curso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Could not acquire lock for user savings update. Please try again later.
 *       500:
 *         description: Error interno durante la actualización
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/:id/savings", UserController.updateSavings);

export default router;
