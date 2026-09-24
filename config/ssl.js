import fs from "fs";
import https from "https";

export function createSSLServer(app, PORT) {
  const httpConfig = {
    key: fs.readFileSync(process.env.SSL_KEY_PATH),
    cert: fs.readFileSync(process.env.SSL_CERT_PATH),
  };

  https.createServer(httpConfig, app).listen(PORT, () => {
    console.log(`Server is running on https://localhost:${PORT}`);
  });
}
