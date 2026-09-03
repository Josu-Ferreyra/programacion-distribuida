import { logger } from "../utils/logger.js";

export const errorHandler = (err, req, res, next) => {
  // Extrae el statusCode si fue asignado en el servicio, o usa 500 por defecto
  const statusCode = err.statusCode || 500;
  const message = err.message || "Error interno del servidor";

  // Registrar el fallo en Winston con metadatos contextuales
  logger.error(`Error en la operación: ${message}`, {
    statusCode,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    stack: err.stack,
  });

  // Respuesta homogénea para el cliente
  res.status(statusCode).json({
    error: message,
  });
};
