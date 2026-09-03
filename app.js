import express from "express";
import swaggerUi from "swagger-ui-express";
import { swaggerDocs } from "./config/swagger.js";
import userRoutes from "./routes/user.routes.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { logger } from "./utils/logger.js";

export const app = express();

// 1. Parsing del cuerpo en JSON
app.use(express.json());

// 2. Documentación interactiva Swagger UI
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// 3. Logger de peticiones entrantes
app.use((req, res, next) => {
  logger.info(`Solicitud entrante: ${req.method} ${req.originalUrl}`, {
    ip: req.ip,
  });
  next();
});

// 4. Montaje de rutas de la API
app.use("/api/users", userRoutes);

// 5. Captura de rutas inexistentes (404)
app.use((req, res, next) => {
  const notFoundError = new Error(
    `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
  );
  notFoundError.statusCode = 404;
  next(notFoundError);
});

// 6. Middleware centralizado de errores (debe ser el último app.use)
app.use(errorHandler);
