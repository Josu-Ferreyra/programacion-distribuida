import { RaftNode } from "./raft-node.js";
import { RaftRpcClient } from "./rpc-client.js";

let raftNode = null;

export function initRaftNode(nodeConfig) {
  raftNode = new RaftNode({
    config: nodeConfig,
    rpc: new RaftRpcClient(nodeConfig.timing.rpcTimeoutMs),
  });
  return raftNode;
}

export function getRaftNode() {
  if (!raftNode) throw new Error("Raft node not initialized");
  return raftNode;
}
