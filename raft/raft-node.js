import { Mutex } from "../utils/mutex.js";
import { logger } from "../utils/logger.js";
import { COMMANDS } from "./state-machine.js";
import {
  CommitTimeoutError,
  LeadershipLostError,
  NotLeaderError,
} from "./errors.js";

export const NODE_ROLES = {
  FOLLOWER: "FOLLOWER",
  CANDIDATE: "CANDIDATE",
  LEADER: "LEADER",
};

const randomBetween = (min, max) =>
  Math.floor(min + Math.random() * (max - min + 1));

// Implementación educativa de Raft para un cluster fijo.
//
// Regla de concurrencia: todo cambio de estado Raft (rol, término, voto, log,
// commitIndex) ocurre dentro de `this.mutex`, y los cambios en memoria se hacen
// de forma síncrona ANTES del primer await, de modo que el resto del proceso
// nunca observa un estado intermedio (p. ej. rol LEADER con un término nuevo).
// Las llamadas de red se hacen fuera del mutex.
export class RaftNode {
  constructor({ config, stateMachine, rpc }) {
    this.id = config.id;
    this.apiUrl = config.apiUrl;
    this.raftUrl = config.raftUrl;
    this.peers = config.peers;
    this.clusterSize = config.clusterSize;
    this.quorum = Math.floor(config.clusterSize / 2) + 1;
    this.timing = config.timing;

    this.stateMachine = stateMachine;
    this.rpc = rpc;
    this.mutex = new Mutex();

    // Estado del protocolo (por ahora sólo en memoria).
    this.currentTerm = 0;
    this.votedFor = null;
    this.log = [{ index: 0, term: 0, command: { type: COMMANDS.NOOP } }]; // centinela
    this.commitIndex = 0;
    this.lastApplied = 0;

    // Estado volátil, reconstruible.
    this.role = NODE_ROLES.FOLLOWER;
    this.leaderId = null;
    this.electionTimer = null;
    this.electionTimeoutMs = null;
    this.heartbeatTimer = null;
    this.lastHeartbeatAt = null;
    this.pending = new Map(); // índice -> propuesta esperando commit+apply
    this.applying = false;
    this.applyRequested = false;
    this.stopped = false;

    // Progreso de replicación conocido por el Leader, por follower.
    this.peerState = Object.fromEntries(
      this.peers.map((peer) => [
        peer.id,
        { nextIndex: 1, matchIndex: 0, inFlight: false, pending: false, reachable: null },
      ]),
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
    for (const [index, proposal] of this.pending) {
      clearTimeout(proposal.timer);
      proposal.reject(new LeadershipLostError({ index, term: proposal.term }));
    }
    this.pending.clear();
  }

  // ---------------------------------------------------------------- consultas

  get lastLogIndex() {
    return this.log.length - 1;
  }

  get lastLogTerm() {
    return this.log[this.lastLogIndex].term;
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
      lastLogIndex: this.lastLogIndex,
      lastLogTerm: this.lastLogTerm,
      commitIndex: this.commitIndex,
      lastApplied: this.lastApplied,
      electionTimeoutMs: this.isLeader ? null : this.electionTimeoutMs,
      lastHeartbeatAt: this.lastHeartbeatAt
        ? new Date(this.lastHeartbeatAt).toISOString()
        : null,
      apiUrl: this.apiUrl,
      raftUrl: this.raftUrl,
      peers: this.peers.map((peer) => {
        const state = this.peerState[peer.id];
        return {
          id: peer.id,
          apiUrl: peer.apiUrl,
          raftUrl: peer.raftUrl,
          ...(this.isLeader
            ? {
                reachable: state.reachable,
                nextIndex: state.nextIndex,
                matchIndex: state.matchIndex,
              }
            : {}),
        };
      }),
    };
  }

  // Estado de cada entrada visto desde este nodo:
  //  LOCAL       -> sólo en el log del Leader
  //  REPLICATED  -> el Leader sabe que está en algún follower, sin mayoría aún
  //  UNCOMMITTED -> en el log de un follower, todavía no confirmada
  //  COMMITTED   -> confirmada por mayoría, pendiente de aplicar
  //  APPLIED     -> confirmada y aplicada en la State Machine local
  getLog({ from = 1, limit = 100 } = {}) {
    const start = Math.max(1, from);
    const entries = this.log.slice(start, start + limit).map((entry) => {
      const replicatedOn = this.isLeader
        ? [
            this.id,
            ...this.peers
              .filter((peer) => this.peerState[peer.id].matchIndex >= entry.index)
              .map((peer) => peer.id),
          ]
        : undefined;

      let state;
      if (entry.index <= this.lastApplied) state = "APPLIED";
      else if (entry.index <= this.commitIndex) state = "COMMITTED";
      else if (this.isLeader) state = replicatedOn.length > 1 ? "REPLICATED" : "LOCAL";
      else state = "UNCOMMITTED";

      return { ...entry, state, ...(replicatedOn ? { replicatedOn } : {}) };
    });

    return {
      nodeId: this.id,
      role: this.role,
      currentTerm: this.currentTerm,
      lastLogIndex: this.lastLogIndex,
      commitIndex: this.commitIndex,
      lastApplied: this.lastApplied,
      entries,
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
        { term: this.currentTerm, lastLogIndex: this.lastLogIndex, lastLogTerm: this.lastLogTerm },
      );

      return {
        term: this.currentTerm,
        candidateId: this.id,
        lastLogIndex: this.lastLogIndex,
        lastLogTerm: this.lastLogTerm,
      };
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
            await this.#becomeLeader([...votes]);
          }
        });
      }),
    );
  }

  async handleRequestVote({ term, candidateId, lastLogIndex, lastLogTerm }) {
    return this.mutex.run(async () => {
      if (term > this.currentTerm) {
        await this.#stepDown(term, `RequestVote de ${candidateId}`);
      }

      let reason = null;
      if (term < this.currentTerm) {
        reason = `término del candidato (${term}) menor al local (${this.currentTerm})`;
      } else if (this.votedFor && this.votedFor !== candidateId) {
        reason = `ya votó por ${this.votedFor} en el término ${this.currentTerm}`;
      } else if (!this.#isCandidateLogUpToDate(lastLogIndex, lastLogTerm)) {
        reason = `log del candidato desactualizado (candidato ${lastLogTerm}/${lastLogIndex}, local ${this.lastLogTerm}/${this.lastLogIndex})`;
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

  // Restricción de elección: sólo se vota a quien tiene un log al menos tan
  // actualizado como el propio (último término mayor, o igual y log más largo).
  #isCandidateLogUpToDate(lastLogIndex, lastLogTerm) {
    if (lastLogTerm !== this.lastLogTerm) return lastLogTerm > this.lastLogTerm;
    return lastLogIndex >= this.lastLogIndex;
  }

  async #becomeLeader(votes) {
    this.role = NODE_ROLES.LEADER;
    this.leaderId = this.id;
    clearTimeout(this.electionTimer);

    for (const peer of this.peers) {
      Object.assign(this.peerState[peer.id], {
        nextIndex: this.lastLogIndex + 1,
        matchIndex: 0,
      });
    }

    logger.info("CANDIDATE -> LEADER: mayoría alcanzada", {
      term: this.currentTerm,
      votes,
      quorum: this.quorum,
    });

    // Entrada NOOP del nuevo término: un Leader sólo puede confirmar por conteo
    // entradas de su propio término, y con ella confirma también las anteriores.
    const noop = {
      index: this.lastLogIndex + 1,
      term: this.currentTerm,
      command: { type: COMMANDS.NOOP, leaderId: this.id },
    };
    this.log.push(noop);

    this.heartbeatTimer = setInterval(
      () => this.#broadcastAppendEntries(),
      this.timing.heartbeatIntervalMs,
    );
    setImmediate(() => this.#broadcastAppendEntries());
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
      for (const [index, proposal] of this.pending) {
        clearTimeout(proposal.timer);
        proposal.reject(new LeadershipLostError({ index, term: proposal.term }));
      }
      this.pending.clear();
      logger.warn("LEADER -> FOLLOWER: se detiene el envío de heartbeats", { reason });
    } else if (previousRole !== NODE_ROLES.FOLLOWER) {
      logger.info(`${previousRole} -> FOLLOWER`, { reason });
    }

    if (termChanged) {
      logger.info(`Término actualizado ${previousTerm} -> ${newTerm}`, { reason });
    }
  }

  // ---------------------------------------------------------------- replicación (Leader)

  async propose(command) {
    return this.mutex.run(async () => {
      if (!this.isLeader) throw new NotLeaderError(this);

      const entry = { index: this.lastLogIndex + 1, term: this.currentTerm, command };

      this.log.push(entry);

      const result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(entry.index);
          logger.warn("Entrada sin quorum dentro del timeout: no confirmada", {
            index: entry.index,
            term: entry.term,
          });
          reject(new CommitTimeoutError(entry, this.timing.commitTimeoutMs));
        }, this.timing.commitTimeoutMs);
        this.pending.set(entry.index, { term: entry.term, resolve, reject, timer });
      });

      logger.info("Entrada agregada al log local del Leader (aún NO committed)", {
        index: entry.index,
        term: entry.term,
        type: command.type,
      });
      setImmediate(() => this.#broadcastAppendEntries());

      return { entry, result };
    }).then(async ({ entry, result }) => ({ entry, result: await result }));
  }

  #broadcastAppendEntries() {
    if (!this.isLeader) return;
    for (const peer of this.peers) {
      this.#replicateTo(peer).catch((error) =>
        logger.error(`Error replicando a ${peer.id}`, { error: error.message }),
      );
    }
  }

  // Un único AppendEntries en vuelo por follower. Si llega trabajo nuevo
  // mientras tanto, se marca `pending` y se reenvía al terminar.
  async #replicateTo(peer) {
    const state = this.peerState[peer.id];
    if (state.inFlight) {
      state.pending = true;
      return;
    }

    state.inFlight = true;
    try {
      do {
        state.pending = false;
        const keepGoing = await this.#sendAppendEntries(peer);
        if (keepGoing) state.pending = true;
      } while (state.pending && this.isLeader);
    } finally {
      state.inFlight = false;
    }
  }

  // Devuelve true si conviene reenviar inmediatamente (faltan entradas o hubo
  // rechazo por inconsistencia).
  async #sendAppendEntries(peer) {
    if (!this.isLeader) return false;

    const state = this.peerState[peer.id];
    const term = this.currentTerm;
    const prevLogIndex = state.nextIndex - 1;
    const request = {
      term,
      leaderId: this.id,
      prevLogIndex,
      prevLogTerm: this.log[prevLogIndex].term,
      entries: this.log.slice(
        state.nextIndex,
        state.nextIndex + this.timing.maxEntriesPerRpc,
      ),
      leaderCommit: this.commitIndex,
    };

    if (request.entries.length === 0) {
      logger.debug(`Heartbeat -> ${peer.id}`, { term, leaderCommit: request.leaderCommit });
    }

    let response;
    try {
      response = await this.rpc.appendEntries(peer, request);
      this.#markPeerReachable(peer, true);
    } catch (error) {
      this.#markPeerReachable(peer, false, error);
      return false;
    }

    return this.mutex.run(async () => {
      if (response.term > this.currentTerm) {
        await this.#stepDown(response.term, `AppendEntries respondido por ${peer.id}`);
        return false;
      }
      if (!this.isLeader || this.currentTerm !== term) return false;

      if (response.success) {
        const matchIndex = prevLogIndex + request.entries.length;
        if (matchIndex > state.matchIndex) state.matchIndex = matchIndex;
        state.nextIndex = state.matchIndex + 1;

        if (request.entries.length > 0) {
          logger.info(`Entradas replicadas en ${peer.id}`, {
            from: request.entries[0].index,
            to: matchIndex,
            matchIndex: state.matchIndex,
          });
        }
        await this.#advanceCommitIndex();
        return state.nextIndex <= this.lastLogIndex;
      }

      // Rechazo por falta de continuidad: retroceder el punto de envío de a
      // una posición y reintentar hasta encontrar la entrada en común.
      const newNextIndex = Math.max(1, state.nextIndex - 1);
      logger.warn(`${peer.id} rechazó AppendEntries por inconsistencia: se retrocede nextIndex`, {
        prevLogIndex,
        reason: response.reason,
        nextIndex: `${state.nextIndex} -> ${newNextIndex}`,
      });
      state.nextIndex = newNextIndex;
      return true;
    });
  }

  #markPeerReachable(peer, reachable, error) {
    const state = this.peerState[peer.id];
    if (state.reachable === reachable) return;
    state.reachable = reachable;
    if (reachable) {
      logger.info(`Peer ${peer.id} accesible`, { nextIndex: state.nextIndex });
    } else {
      logger.warn(`Peer ${peer.id} no responde`, { error: error?.message });
    }
  }

  // Una entrada está committed cuando está en la mayoría de los logs. Sólo se
  // cuentan réplicas de entradas del término actual (Raft §5.4.2).
  async #advanceCommitIndex() {
    for (let n = this.lastLogIndex; n > this.commitIndex; n--) {
      if (this.log[n].term !== this.currentTerm) break;

      const replicas = [
        this.id,
        ...this.peers
          .filter((peer) => this.peerState[peer.id].matchIndex >= n)
          .map((peer) => peer.id),
      ];
      if (replicas.length >= this.quorum) {
        const previous = this.commitIndex;
        this.commitIndex = n;
        logger.info("Entradas COMMITTED por mayoría", {
          from: previous + 1,
          to: n,
          replicas,
          quorum: this.quorum,
        });
        this.#applyCommitted();
        return;
      }
    }
  }

  // ---------------------------------------------------------------- replicación (Follower)

  async handleAppendEntries({ term, leaderId, prevLogIndex, prevLogTerm, entries, leaderCommit }) {
    return this.mutex.run(async () => {
      if (term < this.currentTerm) {
        logger.info(`AppendEntries de ${leaderId} rechazado: término obsoleto`, {
          term,
          currentTerm: this.currentTerm,
        });
        return { term: this.currentTerm, success: false, reason: "término obsoleto" };
      }

      // Un Leader válido para un término >= al local: se lo reconoce.
      if (term > this.currentTerm || this.role !== NODE_ROLES.FOLLOWER) {
        await this.#stepDown(term, `AppendEntries de ${leaderId}`);
      }
      if (this.leaderId !== leaderId) {
        this.leaderId = leaderId;
        logger.info(`Leader reconocido: ${leaderId}`, { term });
      }
      this.lastHeartbeatAt = Date.now();
      this.#resetElectionTimer();

      if (entries.length === 0) {
        logger.debug(`Heartbeat <- ${leaderId}`, { term, leaderCommit });
      }

      // Verificación de continuidad con la entrada previa.
      if (prevLogIndex > this.lastLogIndex) {
        const reason = `falta la entrada previa ${prevLogIndex} (lastLogIndex local = ${this.lastLogIndex})`;
        logger.info(`Log atrasado respecto del Leader: ${reason}`);
        return { term, success: false, reason };
      }
      if (this.log[prevLogIndex].term !== prevLogTerm) {
        const reason = `término distinto en la entrada ${prevLogIndex} (local ${this.log[prevLogIndex].term}, leader ${prevLogTerm})`;
        logger.info(`Log inconsistente con el Leader: ${reason}`);
        return { term, success: false, reason };
      }

      // Agregar entradas nuevas; si una existente entra en conflicto (mismo
      // índice, distinto término) se trunca desde ahí.
      let newEntries = [];
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (entry.index > this.lastLogIndex) {
          newEntries = entries.slice(i);
          break;
        }
        if (this.log[entry.index].term !== entry.term) {
          logger.warn("Conflicto con el log del Leader: se truncan entradas no confirmadas", {
            from: entry.index,
            to: this.lastLogIndex,
          });
          this.log.length = entry.index;
          newEntries = entries.slice(i);
          break;
        }
      }

      if (newEntries.length > 0) {
        this.log.push(...newEntries);
        logger.info(`Entradas replicadas desde ${leaderId} al log local`, {
          from: newEntries[0].index,
          to: this.lastLogIndex,
        });
      }

      const lastNewIndex = prevLogIndex + entries.length;
      if (leaderCommit > this.commitIndex) {
        const newCommitIndex = Math.max(
          this.commitIndex,
          Math.min(leaderCommit, lastNewIndex),
        );
        if (newCommitIndex > this.commitIndex) {
          logger.info("commitIndex avanzado según el Leader", {
            from: this.commitIndex,
            to: newCommitIndex,
          });
          this.commitIndex = newCommitIndex;
          this.#applyCommitted();
        }
      }

      return { term: this.currentTerm, success: true, lastLogIndex: this.lastLogIndex };
    });
  }

  // ---------------------------------------------------------------- State Machine

  // Aplica en orden las entradas (lastApplied, commitIndex]. Nunca hay dos
  // ejecuciones en paralelo; si se pide mientras corre, se repite al terminar.
  async #applyCommitted() {
    if (this.applying) {
      this.applyRequested = true;
      return;
    }

    this.applying = true;
    try {
      do {
        this.applyRequested = false;
        while (this.lastApplied < this.commitIndex) {
          const entry = this.log[this.lastApplied + 1];
          const result = await this.stateMachine.apply(entry);
          this.lastApplied = entry.index;

          logger.info("Entrada aplicada a la State Machine", {
            index: entry.index,
            term: entry.term,
            type: entry.command.type,
            ok: result.ok,
            ...(result.ok ? {} : { error: result.error }),
          });
          this.#settleProposal(entry, result);
        }
      } while (this.applyRequested);
    } catch (error) {
      logger.error("Error aplicando entradas a la State Machine; se reintentará", {
        lastApplied: this.lastApplied,
        error: error.message,
      });
      setTimeout(() => this.#applyCommitted(), 1000);
    } finally {
      this.applying = false;
    }
  }

  #settleProposal(entry, result) {
    const proposal = this.pending.get(entry.index);
    if (!proposal) return;

    clearTimeout(proposal.timer);
    this.pending.delete(entry.index);
    if (proposal.term === entry.term) proposal.resolve(result);
    else proposal.reject(new LeadershipLostError({ index: entry.index, term: proposal.term }));
  }
}
