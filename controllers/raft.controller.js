import { NODE } from "../server.js";

export const RaftController = {
  getStatus: (req, res, next) => {
    try {
      const nodeStatus = NODE.getStatus();
      res.status(200).json(nodeStatus);
    } catch (error) {
      next(error);
    }
  },
};
