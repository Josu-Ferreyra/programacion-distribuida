import { RaftState } from "../models/raft-state.model.js";
import { RaftLogEntry } from "../models/raft-log.model.js";

// Escrituras críticas del protocolo: se espera confirmación del journal para que
// un crash inmediatamente posterior no pierda el voto, el término o el log.
const DURABLE = { writeConcern: { w: 1, j: true } };

export class RaftStorage {
  constructor(nodeId) {
    this.nodeId = nodeId;
  }

  async load() {
    const state = await RaftState.findById(this.nodeId).lean();
    const entries = await RaftLogEntry.find({}, { _id: 0 })
      .sort({ index: 1 })
      .lean();

    entries.forEach((entry, position) => {
      if (entry.index !== position + 1) {
        throw new Error(
          `Log persistido corrupto: se esperaba índice ${position + 1} y se encontró ${entry.index}`,
        );
      }
    });

    return {
      currentTerm: state?.currentTerm ?? 0,
      votedFor: state?.votedFor ?? null,
      commitIndex: state?.commitIndex ?? 0,
      lastApplied: state?.lastApplied ?? 0,
      entries,
    };
  }

  async saveTermAndVote(currentTerm, votedFor) {
    await this.#saveState({ currentTerm, votedFor });
  }

  async saveCommitIndex(commitIndex) {
    await this.#saveState({ commitIndex });
  }

  async saveLastApplied(lastApplied) {
    await this.#saveState({ lastApplied });
  }

  async appendEntries(entries) {
    if (entries.length === 0) return;
    await RaftLogEntry.insertMany(
      entries.map(({ index, term, command }) => ({ index, term, command })),
      DURABLE,
    );
  }

  // Elimina las entradas desde `index` (inclusive) en adelante.
  async truncateFrom(index) {
    await RaftLogEntry.deleteMany({ index: { $gte: index } }, DURABLE);
  }

  async #saveState(fields) {
    await RaftState.updateOne(
      { _id: this.nodeId },
      { $set: fields },
      { upsert: true, ...DURABLE },
    );
  }
}
