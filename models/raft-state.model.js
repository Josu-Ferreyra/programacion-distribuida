import mongoose from "mongoose";

// Estado Raft que debe sobrevivir a un reinicio. Un único documento por nodo.
// - currentTerm y votedFor: obligatorios para no votar dos veces en un término
//   ni retroceder el término.
// - commitIndex y lastApplied: opcionales en Raft, se persisten para que la
//   State Machine retome exactamente donde quedó.
const raftStateSchema = new mongoose.Schema(
  {
    _id: { type: String }, // nodeId
    currentTerm: { type: Number, default: 0 },
    votedFor: { type: String, default: null },
    commitIndex: { type: Number, default: 0 },
    lastApplied: { type: Number, default: 0 },
  },
  { collection: "raft_state", versionKey: false },
);

export const RaftState = mongoose.model("RaftState", raftStateSchema);
