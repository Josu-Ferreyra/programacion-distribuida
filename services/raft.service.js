const NODE_ROLES = {
  FOLLOWER: "follower",
  CANDIDATE: "candidate",
  LEADER: "leader",
};

export class RaftNode {
  constructor(NODE_CONFIG) {
    this.id = NODE_CONFIG.id;
    this.port = NODE_CONFIG.port;
    this.peers = NODE_CONFIG.peers;

    this.currentTerm = 0;
    this.votedFor = null;
    this.role = NODE_ROLES.FOLLOWER;
    this.leaderId = null;
  }

  getStatus() {
    return {
      id: this.id,
      port: this.port,
      currentTerm: this.currentTerm,
      votedFor: this.votedFor,
      role: this.role,
      leaderId: this.leaderId,
      peers: this.peers,
    };
  }
}
