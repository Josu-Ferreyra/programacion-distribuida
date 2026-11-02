import { getRaftNode } from "../raft/index.js";

export const RaftController = {
  getStatus: (req, res, next) => {
    try {
      res.status(200).json(getRaftNode().getStatus());
    } catch (error) {
      next(error);
    }
  },
};
