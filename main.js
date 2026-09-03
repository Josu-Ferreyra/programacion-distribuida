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
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

dotenv.config();

try {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("🍃 MongoDB connected");
} catch (error) {
  console.error("❌ Error connecting MongoDB:", error);
  process.exit(1);
}

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "API de Usuarios y Ahorros",
      version: "1.0.0",
      description: "API concurrente con Redis, MongoDB y logging con Winston",
    },
    servers: [
      {
        url: "https://localhost:3000",
        description: "Servidor local de desarrollo",
      },
    ],
    components: {
      schemas: {
        UserInput: {
          type: "object",
          required: [
            "name",
            "lastName",
            "age",
            "profession",
            "nativeLanguage",
            "country",
          ],
          properties: {
            name: { type: "string", example: "Martín" },
            lastName: { type: "string", example: "Pérez" },
            age: { type: "integer", example: 28 },
            profession: { type: "string", example: "Software Engineer" },
            nativeLanguage: { type: "string", example: "Spanish" },
            country: { type: "string", example: "Argentina" },
            yearsOfExperience: { type: "integer", example: 4 },
          },
        },
        User: {
          allOf: [
            { $ref: "#/components/schemas/UserInput" },
            {
              type: "object",
              properties: {
                _id: { type: "string", example: "664c1234567890abcdef1234" },
                savings: { type: "number", example: 1500 },
                createdAt: { type: "string", format: "date-time" },
                updatedAt: { type: "string", format: "date-time" },
              },
            },
          ],
        },
        ErrorResponse: {
          type: "object",
          properties: {
            error: { type: "string", example: "Mensaje descriptivo del error" },
          },
        },
      },
    },
  },
  apis: ["./main.js"], // Archivos donde buscará las anotaciones JSDoc
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);

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

// Ruta para exponer la interfaz interactiva
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));

app.use((req, res, next) => {
  logger.info(`Solicitud entrante: ${req.method} ${req.originalUrl}`, {
    ip: req.ip,
  });
  next();
});

// Routes
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
app.get("/api/users", async (req, res) => {
  const users = await User.find();
  res.status(200).json(users);
});

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
app.delete("/api/users/:id", async (req, res) => {
  try {
    const deletedUser = await User.findByIdAndDelete(req.params.id);
    res.status(204).json(deletedUser);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

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
