import { RaftNode } from "./raft-node.js";

let raftNode = null;

export function initRaftNode(nodeConfig) {
  raftNode = new RaftNode({
    config: nodeConfig,
  });
  return raftNode;
}

export function getRaftNode() {
  if (!raftNode) throw new Error("Raft node not initialized");
  return raftNode;
}
