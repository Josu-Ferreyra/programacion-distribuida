import { Mutex } from "../utils/mutex.js";
import { logger } from "../utils/logger.js";

export const NODE_ROLES = {
  FOLLOWER: "FOLLOWER",
  CANDIDATE: "CANDIDATE",
  LEADER: "LEADER",
};

const randomBetween = (min, max) =>
  Math.floor(min + Math.random() * (max - min + 1));

// Implementación educativa de Raft para un cluster fijo.
//
// Regla de concurrencia: todo cambio de estado Raft (rol, término, voto) ocurre
// dentro de `this.mutex`, y los cambios en memoria se hacen de forma síncrona
// ANTES del primer await, de modo que el resto del proceso nunca observa un
// estado intermedio. Las llamadas de red se hacen fuera del mutex.
export class RaftNode {
  constructor({ config, rpc }) {
    this.id = config.id;
    this.apiUrl = config.apiUrl;
    this.raftUrl = config.raftUrl;
    this.peers = config.peers;
    this.clusterSize = config.clusterSize;
    this.quorum = Math.floor(config.clusterSize / 2) + 1;
    this.timing = config.timing;

    this.rpc = rpc;
    this.mutex = new Mutex();

    this.currentTerm = 0;
    this.votedFor = null;

    this.role = NODE_ROLES.FOLLOWER;
    this.leaderId = null;
    this.electionTimer = null;
    this.electionTimeoutMs = null;
    this.heartbeatTimer = null;
    this.lastHeartbeatAt = null;
    this.stopped = false;

    // Accesibilidad de cada follower vista por el Leader.
    this.peerState = Object.fromEntries(
      this.peers.map((peer) => [peer.id, { reachable: null }]),
    );
  }

  // ---------------------------------------------------------------- ciclo de vida

  async start() {
    this.#resetElectionTimer();
    logger.info(`Nodo iniciado como ${this.role}`, {
      term: this.currentTerm,
      electionTimeoutMs: this.electionTimeoutMs,
    });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.electionTimer);
    clearInterval(this.heartbeatTimer);
  }

  // ---------------------------------------------------------------- consultas

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
      electionTimeoutMs: this.isLeader ? null : this.electionTimeoutMs,
      lastHeartbeatAt: this.lastHeartbeatAt
        ? new Date(this.lastHeartbeatAt).toISOString()
        : null,
      apiUrl: this.apiUrl,
      raftUrl: this.raftUrl,
      peers: this.peers.map((peer) => ({
        id: peer.id,
        apiUrl: peer.apiUrl,
        raftUrl: peer.raftUrl,
        ...(this.isLeader ? { reachable: this.peerState[peer.id].reachable } : {}),
      })),
    };
  }

  // ---------------------------------------------------------------- elección

  #resetElectionTimer() {
    clearTimeout(this.electionTimer);
    if (this.stopped || this.isLeader) return;

    // Timeout aleatorio en cada reinicio: evita que todos los nodos venzan a la
    // vez y se dividan los votos indefinidamente.
    this.electionTimeoutMs = randomBetween(
      this.timing.electionTimeoutMinMs,
      this.timing.electionTimeoutMaxMs,
    );
    this.electionTimer = setTimeout(() => {
      this.#startElection().catch((error) =>
        logger.error("Error durante la elección", { error: error.message }),
      );
    }, this.electionTimeoutMs);
  }

  async #startElection() {
    const request = await this.mutex.run(async () => {
      if (this.isLeader || this.stopped) return null;

      const previousRole = this.role;
      this.role = NODE_ROLES.CANDIDATE;
      this.currentTerm += 1;
      this.votedFor = this.id;
      this.leaderId = null;
      this.#resetElectionTimer(); // si la elección no concluye, se reintenta

      logger.info(
        previousRole === NODE_ROLES.CANDIDATE
          ? "Elección sin mayoría (votos divididos o peers caídos): nuevo intento"
          : `Election timeout vencido: ${previousRole} -> CANDIDATE, inicia elección`,
        { term: this.currentTerm },
      );

      return { term: this.currentTerm, candidateId: this.id };
    });
    if (!request) return;

    const votes = new Set([this.id]); // voto propio

    await Promise.all(
      this.peers.map(async (peer) => {
        let response;
        try {
          response = await this.rpc.requestVote(peer, request);
        } catch (error) {
          logger.debug(`RequestVote a ${peer.id} sin respuesta`, { error: error.message });
          return;
        }

        await this.mutex.run(async () => {
          if (response.term > this.currentTerm) {
            await this.#stepDown(response.term, `respuesta de voto de ${peer.id}`);
            return;
          }
          // Respuesta obsoleta: la elección de ese término ya terminó.
          if (this.role !== NODE_ROLES.CANDIDATE || this.currentTerm !== request.term) {
            return;
          }

          if (!response.voteGranted) {
            logger.info(`Voto rechazado por ${peer.id}`, {
              term: request.term,
              reason: response.reason,
            });
            return;
          }

          votes.add(peer.id);
          logger.info(`Voto recibido de ${peer.id}`, {
            term: request.term,
            votes: votes.size,
            quorum: this.quorum,
          });
          if (votes.size >= this.quorum) {
            this.#becomeLeader([...votes]);
          }
        });
      }),
    );
  }

  async handleRequestVote({ term, candidateId }) {
    return this.mutex.run(async () => {
      if (term > this.currentTerm) {
        await this.#stepDown(term, `RequestVote de ${candidateId}`);
      }

      let reason = null;
      if (term < this.currentTerm) {
        reason = `término del candidato (${term}) menor al local (${this.currentTerm})`;
      } else if (this.votedFor && this.votedFor !== candidateId) {
        reason = `ya votó por ${this.votedFor} en el término ${this.currentTerm}`;
      }

      if (reason) {
        logger.info(`Voto denegado a ${candidateId}`, { term: this.currentTerm, reason });
        return { term: this.currentTerm, voteGranted: false, reason };
      }

      this.votedFor = candidateId;
      this.#resetElectionTimer();
      logger.info(`Voto concedido a ${candidateId}`, { term: this.currentTerm });
      return { term: this.currentTerm, voteGranted: true };
    });
  }

  #becomeLeader(votes) {
    this.role = NODE_ROLES.LEADER;
    this.leaderId = this.id;
    clearTimeout(this.electionTimer);

    logger.info("CANDIDATE -> LEADER: mayoría alcanzada", {
      term: this.currentTerm,
      votes,
      quorum: this.quorum,
    });

    this.heartbeatTimer = setInterval(
      () => this.#broadcastHeartbeat(),
      this.timing.heartbeatIntervalMs,
    );
    setImmediate(() => this.#broadcastHeartbeat());
  }

  async #stepDown(newTerm, reason) {
    const previousRole = this.role;
    const previousTerm = this.currentTerm;
    const termChanged = newTerm > this.currentTerm;

    if (termChanged) {
      this.currentTerm = newTerm;
      this.votedFor = null;
      this.leaderId = null;
    }
    this.role = NODE_ROLES.FOLLOWER;

    if (previousRole === NODE_ROLES.LEADER) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.#resetElectionTimer();
      logger.warn("LEADER -> FOLLOWER: se detiene el envío de heartbeats", { reason });
    } else if (previousRole !== NODE_ROLES.FOLLOWER) {
      logger.info(`${previousRole} -> FOLLOWER`, { reason });
    }

    if (termChanged) {
      logger.info(`Término actualizado ${previousTerm} -> ${newTerm}`, { reason });
    }
  }

  // ---------------------------------------------------------------- heartbeats

  // AppendEntries sin entradas: el Leader avisa periódicamente que sigue vivo.
  #broadcastHeartbeat() {
    if (!this.isLeader) return;
    for (const peer of this.peers) {
      this.#sendHeartbeat(peer).catch((error) =>
        logger.error(`Error enviando heartbeat a ${peer.id}`, { error: error.message }),
      );
    }
  }

  async #sendHeartbeat(peer) {
    const term = this.currentTerm;
    logger.debug(`Heartbeat -> ${peer.id}`, { term });

    let response;
    try {
      response = await this.rpc.appendEntries(peer, { term, leaderId: this.id, entries: [] });
      this.#markPeerReachable(peer, true);
    } catch (error) {
      this.#markPeerReachable(peer, false, error);
      return;
    }

    await this.mutex.run(async () => {
      if (response.term > this.currentTerm) {
        await this.#stepDown(response.term, `AppendEntries respondido por ${peer.id}`);
      }
    });
  }

  #markPeerReachable(peer, reachable, error) {
    const state = this.peerState[peer.id];
    if (state.reachable === reachable) return;
    state.reachable = reachable;
    if (reachable) {
      logger.info(`Peer ${peer.id} accesible`);
    } else {
      logger.warn(`Peer ${peer.id} no responde`, { error: error?.message });
    }
  }

  async handleAppendEntries({ term, leaderId }) {
    return this.mutex.run(async () => {
      if (term < this.currentTerm) {
        logger.info(`AppendEntries de ${leaderId} rechazado: término obsoleto`, {
          term,
          currentTerm: this.currentTerm,
        });
        return { term: this.currentTerm, success: false, reason: "término obsoleto" };
      }

      // Un Leader válido para un término >= al local: se lo reconoce y se
      // renueva el election timer. Sólo en este caso se reinicia el timer.
      if (term > this.currentTerm || this.role !== NODE_ROLES.FOLLOWER) {
        await this.#stepDown(term, `AppendEntries de ${leaderId}`);
      }
      if (this.leaderId !== leaderId) {
        this.leaderId = leaderId;
        logger.info(`Leader reconocido: ${leaderId}`, { term });
      }
      this.lastHeartbeatAt = Date.now();
      this.#resetElectionTimer();
      logger.debug(`Heartbeat <- ${leaderId}`, { term });

      return { term: this.currentTerm, success: true };
    });
  }
}
