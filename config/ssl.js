import fs from "fs";
import https from "https";
import { logger } from "../utils/logger.js";

export function createSSLServer(app, PORT) {
  const httpConfig = {
    key: fs.readFileSync(process.env.SSL_KEY_PATH),
    cert: fs.readFileSync(process.env.SSL_CERT_PATH),
  };

  return https.createServer(httpConfig, app).listen(PORT, () => {
    logger.info(`API HTTPS escuchando en https://localhost:${PORT}`);
  });
}
