import mongoose from "mongoose";

// Entrada del log replicado: { posición, término, comando }.
const raftLogEntrySchema = new mongoose.Schema(
  {
    index: { type: Number, required: true, unique: true },
    term: { type: Number, required: true },
    command: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { collection: "raft_log", versionKey: false, minimize: false },
);

export const RaftLogEntry = mongoose.model("RaftLogEntry", raftLogEntrySchema);
