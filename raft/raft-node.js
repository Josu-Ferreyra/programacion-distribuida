export const NODE_ROLES = {
  FOLLOWER: "FOLLOWER",
  CANDIDATE: "CANDIDATE",
  LEADER: "LEADER",
};

// Identidad y estado observable del nodo. El protocolo se incorpora por hitos.
export class RaftNode {
  constructor({ config }) {
    this.id = config.id;
    this.apiUrl = config.apiUrl;
    this.raftUrl = config.raftUrl;
    this.peers = config.peers;
    this.clusterSize = config.clusterSize;
    this.quorum = Math.floor(config.clusterSize / 2) + 1;

    this.currentTerm = 0;
    this.votedFor = null;
    this.role = NODE_ROLES.FOLLOWER;
    this.leaderId = null;
  }

  get isLeader() {
    return this.role === NODE_ROLES.LEADER;
  }

  get leaderApiUrl() {
    if (!this.leaderId) return null;
    if (this.leaderId === this.id) return this.apiUrl;
    return this.peers.find((peer) => peer.id === this.leaderId)?.apiUrl ?? null;
  }

  getStatus() {
    return {
      nodeId: this.id,
      pid: process.pid,
      role: this.role,
      currentTerm: this.currentTerm,
      votedFor: this.votedFor,
      leaderId: this.leaderId,
      leaderUrl: this.leaderApiUrl,
      clusterSize: this.clusterSize,
      quorum: this.quorum,
      apiUrl: this.apiUrl,
      raftUrl: this.raftUrl,
      peers: this.peers.map(({ id, apiUrl, raftUrl }) => ({ id, apiUrl, raftUrl })),
    };
  }
}
