import { RaftNode } from "./raft-node.js";
import { RaftStorage } from "./raft-storage.js";
import { RaftRpcClient } from "./rpc-client.js";
import { UserStateMachine } from "./state-machine.js";

let raftNode = null;

export function initRaftNode(nodeConfig) {
  raftNode = new RaftNode({
    config: nodeConfig,
    storage: new RaftStorage(nodeConfig.id),
    stateMachine: new UserStateMachine(),
    rpc: new RaftRpcClient(nodeConfig.timing.rpcTimeoutMs),
  });
  return raftNode;
}

export function getRaftNode() {
  if (!raftNode) throw new Error("Raft node not initialized");
  return raftNode;
}
