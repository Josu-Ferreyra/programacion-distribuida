// Lanza los tres nodos como procesos independientes en una sola terminal.
// Ctrl+C detiene los tres. Para simular caídas individuales conviene usar una
// terminal por nodo (npm run node1 / node2 / node3) o `kill <pid>`.
import { spawn } from "child_process";

const children = ["node1", "node2", "node3"].map((nodeId) =>
  spawn(process.execPath, ["server.js", nodeId], { stdio: "inherit" }),
);

const stopAll = (signal) => {
  for (const child of children) child.kill(signal);
};
process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));
