import { getRaftNode } from "../raft/index.js";

export const RaftController = {
  getStatus: (req, res, next) => {
    try {
      res.status(200).json(getRaftNode().getStatus());
    } catch (error) {
      next(error);
    }
  },
  getLog: (req, res, next) => {
    try {
      const from = Number(req.query.from ?? 1);
      const limit = Math.min(Number(req.query.limit ?? 100), 1000);
      if (!Number.isInteger(from) || !Number.isInteger(limit) || limit < 1) {
        return res.status(400).json({ error: "from and limit must be positive integers" });
      }
      res.status(200).json(getRaftNode().getLog({ from, limit }));
    } catch (error) {
      next(error);
    }
  },
};
