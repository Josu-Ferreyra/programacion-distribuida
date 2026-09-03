import fs from "fs";
import https from "https";

export function createSSLServer(app) {
  const PORT = process.env.PORT || 3000;

  const httpConfig = {
    key: fs.readFileSync(process.env.SSL_KEY_PATH),
    cert: fs.readFileSync(process.env.SSL_CERT_PATH),
  };

  https.createServer(httpConfig, app).listen(PORT, () => {
    console.log(`Server is running on https://localhost:${PORT}`);
  });
}
