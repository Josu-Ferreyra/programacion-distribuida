import winston from "winston";

// Cada nodo escribe sus propios archivos de log para poder seguir el cluster
// por separado (logs/node1-combined.log, logs/node2-combined.log, ...).
const NODE_ID = process.argv[2] || process.env.NODE_ID || "node";

const consoleFormat = winston.format.printf(
  ({ timestamp, level, message, nodeId, ...meta }) => {
    const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} [${nodeId}] ${level}: ${message}${extra}`;
  },
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  defaultMeta: { nodeId: NODE_ID },
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
    winston.format.errors({ stack: true }), // Captura la traza del error
    winston.format.json(), // Formato estructurado ideal para logs
  ),
  transports: [
    new winston.transports.File({
      filename: `logs/${NODE_ID}-error.log`,
      level: "error",
    }),
    new winston.transports.File({ filename: `logs/${NODE_ID}-combined.log` }),
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), consoleFormat),
    }),
  ],
});
