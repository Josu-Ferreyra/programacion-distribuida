// Muestra el estado de los tres nodos y un hash de los usuarios de cada base
// para verificar convergencia. Sólo usa endpoints de lectura de la API externa.
//   npm run status            -> tabla de estado
//   npm run status -- --log   -> además, el log de cada nodo
import "dotenv/config";
import crypto from "crypto";
import { getClusterNodes } from "../config/cluster.js";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // certificado autofirmado local
process.removeAllListeners("warning");

const showLog = process.argv.includes("--log");

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
  return response.json();
}

const rows = await Promise.all(
  getClusterNodes().map(async (node) => {
    try {
      const [status, users, log] = await Promise.all([
        getJson(`${node.apiUrl}/api/raft/status`),
        getJson(`${node.apiUrl}/api/users`),
        showLog ? getJson(`${node.apiUrl}/api/raft/log?limit=1000`) : null,
      ]);
      const usersHash = crypto
        .createHash("sha256")
        .update(JSON.stringify([...users].sort((a, b) => a._id.localeCompare(b._id))))
        .digest("hex")
        .slice(0, 12);
      return { node: node.id, status, users, usersHash, log };
    } catch {
      return { node: node.id, down: true };
    }
  }),
);

console.table(
  Object.fromEntries(
    rows.map((row) => [
      row.node,
      row.down
        ? { role: "DOWN" }
        : {
            pid: row.status.pid,
            role: row.status.role,
            term: row.status.currentTerm,
            votedFor: row.status.votedFor,
            leader: row.status.leaderId,
            lastLogIndex: row.status.lastLogIndex,
            commitIndex: row.status.commitIndex,
            lastApplied: row.status.lastApplied,
            users: row.users.length,
            usersHash: row.usersHash,
          },
    ]),
  ),
);

if (showLog) {
  for (const row of rows.filter((r) => !r.down)) {
    console.log(`\n--- log de ${row.node} (${row.log.role}, term ${row.log.currentTerm})`);
    console.table(
      row.log.entries.map((entry) => ({
        index: entry.index,
        term: entry.term,
        type: entry.command.type,
        state: entry.state,
        replicatedOn: entry.replicatedOn?.join(",") ?? "",
      })),
    );
  }
}
