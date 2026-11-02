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
    this.stopped = false;
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
      apiUrl: this.apiUrl,
      raftUrl: this.raftUrl,
      peers: this.peers.map(({ id, apiUrl, raftUrl }) => ({ id, apiUrl, raftUrl })),
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

  // Todavía sin heartbeats: los followers no se enteran del Leader y vuelven a
  // iniciar elecciones cuando vence su timeout.
  #becomeLeader(votes) {
    this.role = NODE_ROLES.LEADER;
    this.leaderId = this.id;
    clearTimeout(this.electionTimer);

    logger.info("CANDIDATE -> LEADER: mayoría alcanzada", {
      term: this.currentTerm,
      votes,
      quorum: this.quorum,
    });
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
      this.#resetElectionTimer();
      logger.warn("LEADER -> FOLLOWER", { reason });
    } else if (previousRole !== NODE_ROLES.FOLLOWER) {
      logger.info(`${previousRole} -> FOLLOWER`, { reason });
    }

    if (termChanged) {
      logger.info(`Término actualizado ${previousTerm} -> ${newTerm}`, { reason });
    }
  }
}
