import { UserService } from "../services/user.service.js";
import { getRaftNode } from "../raft/index.js";

// Expone en headers en qué entrada del log quedó confirmada la escritura.
function setRaftHeaders(res, raft) {
  res.set({
    "X-Raft-Node": getRaftNode().id,
    "X-Raft-Index": String(raft.index),
    "X-Raft-Term": String(raft.term),
  });
}

export const UserController = {
  getAll: async (req, res, next) => {
    try {
      const users = await UserService.getAll();
      res.set("X-Raft-Node", getRaftNode().id);
      res.status(200).json(users);
    } catch (error) {
      next(error);
    }
  },
  getById: async (req, res, next) => {
    try {
      const user = await UserService.getById(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.set("X-Raft-Node", getRaftNode().id);
      res.status(200).json(user);
    } catch (error) {
      next(error);
    }
  },
  create: async (req, res, next) => {
    try {
      const { data, raft } = await UserService.create(req.body);
      setRaftHeaders(res, raft);
      res.status(201).json(data);
    } catch (error) {
      next(error);
    }
  },
  update: async (req, res, next) => {
    try {
      const { data, raft } = await UserService.update(req.params.id, req.body);
      setRaftHeaders(res, raft);
      res.status(200).json(data);
    } catch (error) {
      next(error);
    }
  },
  delete: async (req, res, next) => {
    try {
      const { raft } = await UserService.delete(req.params.id);
      setRaftHeaders(res, raft);
      res.status(200).json({ message: "User deleted successfully" });
    } catch (error) {
      next(error);
    }
  },
  updateSavings: async (req, res, next) => {
    try {
      const { amount } = req.body ?? {};
      if (typeof amount !== "number") {
        return res.status(400).json({ error: "Amount must be a number" });
      }

      const newSavings = await UserService.updateSavings(req.params.id, amount);
      res
        .status(200)
        .json({ message: "Savings updated successfully", savings: newSavings });
    } catch (error) {
      next(error);
    }
  },
};
