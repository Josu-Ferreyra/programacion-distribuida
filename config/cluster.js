// Configuración común del cluster: cada proceso elige su identidad (nodeId) al
// iniciar y de ella derivan puertos, base de datos y lista de peers.
const API_HOST = process.env.CLUSTER_API_HOST || "localhost";
const RAFT_HOST = process.env.CLUSTER_RAFT_HOST || "127.0.0.1";

function defineNode(number) {
  const id = `node${number}`;
  const apiPort = Number(process.env[`API_PORT_NODE_${number}`] || 3000 + number);
  const raftPort = Number(
    process.env[`RAFT_PORT_NODE_${number}`] || 4000 + number,
  );

  return {
    id,
    apiPort,
    raftPort,
    apiUrl: `https://${API_HOST}:${apiPort}`,
    raftUrl: `http://${RAFT_HOST}:${raftPort}`,
    mongoUri:
      process.env[`MONGO_URI_NODE_${number}`] ||
      `mongodb://localhost:27017/tp4_${id}`,
  };
}

const CLUSTER_NODES = Object.fromEntries(
  [1, 2, 3].map((number) => {
    const node = defineNode(number);
    return [node.id, node];
  }),
);

export const RAFT_TIMING = {
  electionTimeoutMinMs: Number(process.env.RAFT_ELECTION_TIMEOUT_MIN_MS || 1500),
  electionTimeoutMaxMs: Number(process.env.RAFT_ELECTION_TIMEOUT_MAX_MS || 3000),
  heartbeatIntervalMs: Number(process.env.RAFT_HEARTBEAT_INTERVAL_MS || 500),
  rpcTimeoutMs: Number(process.env.RAFT_RPC_TIMEOUT_MS || 300),
  commitTimeoutMs: Number(process.env.RAFT_COMMIT_TIMEOUT_MS || 5000),
  maxEntriesPerRpc: Number(process.env.RAFT_MAX_ENTRIES_PER_RPC || 50),
};

export function getClusterNodes() {
  return Object.values(CLUSTER_NODES);
}

export function getRaftNodeConfig(nodeId) {
  const node = CLUSTER_NODES[nodeId];
  if (!node) {
    throw new Error(
      `NODE_ID: ${nodeId} doesn't exist (valid: ${Object.keys(CLUSTER_NODES).join(", ")})`,
    );
  }

  const peers = getClusterNodes().filter((peer) => peer.id !== nodeId);

  return {
    ...node,
    peers,
    clusterSize: peers.length + 1,
    timing: RAFT_TIMING,
  };
}
