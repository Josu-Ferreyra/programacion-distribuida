// Cliente HTTP de los RPC internos de Raft.
export class RaftRpcClient {
  constructor(timeoutMs) {
    this.timeoutMs = timeoutMs;
  }

  requestVote(peer, request) {
    return this.#post(peer, "request-vote", request);
  }

  async #post(peer, rpc, body) {
    const response = await fetch(`${peer.raftUrl}/raft/${rpc}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`${rpc} a ${peer.id} respondió HTTP ${response.status}`);
    }

    return response.json();
  }
}
