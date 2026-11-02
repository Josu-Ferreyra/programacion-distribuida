import { logger } from "../utils/logger.js";

const BAD_REQUEST_ERRORS = new Set(["ValidationError", "CastError"]);

export const errorHandler = (err, req, res, next) => {
  // Extrae el statusCode si fue asignado en el servicio, o usa 500 por defecto
  const statusCode =
    err.statusCode || (BAD_REQUEST_ERRORS.has(err.name) ? 400 : 500);
  const message = err.message || "Error interno del servidor";

  // Registrar el fallo en Winston con metadatos contextuales
  const level = statusCode >= 500 ? "error" : "warn";
  logger[level](`Error en la operación: ${message}`, {
    statusCode,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    ...(statusCode >= 500 ? { stack: err.stack } : {}),
  });

  if (err.details?.leaderUrl) {
    res.set("X-Raft-Leader", err.details.leaderUrl);
  }
  if (statusCode === 503) {
    res.set("Retry-After", "2");
  }

  // Respuesta homogénea para el cliente
  res.status(statusCode).json({
    error: message,
    ...err.details,
  });
};
