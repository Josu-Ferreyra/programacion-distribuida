const CLUSTER_NODES = {
  node1: {
    id: "node1",
    port: 3001,
    mongoUri:
      process.env.MONGO_URI_NODE_1 || "mongodb://localhost:27017/tp4_node1",
    url: "https://localhost:3001",
  },
  node2: {
    id: "node2",
    port: 3002,
    mongoUri:
      process.env.MONGO_URI_NODE_2 || "mongodb://localhost:27017/tp4_node2",
    url: "https://localhost:3002",
  },
  node3: {
    id: "node3",
    port: 3003,
    mongoUri:
      process.env.MONGO_URI_NODE_3 || "mongodb://localhost:27017/tp4_node3",
    url: "https://localhost:3003",
  },
};

export function getRaftNodeConfig(nodeId) {
  const node = CLUSTER_NODES[nodeId];
  if (!node) {
    throw new Error(`NODE_ID: ${nodeId} doesn't exist`);
  }

  const peers = Object.values(CLUSTER_NODES).filter(
    (peer) => peer.id !== nodeId,
  );

  return {
    ...node,
    peers,
  };
}
