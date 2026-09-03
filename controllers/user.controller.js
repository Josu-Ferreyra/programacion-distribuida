import { UserService } from "../services/user.service.js";

export const UserController = {
  getAll: async (req, res, next) => {
    try {
      const users = await UserService.getAll();
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
      res.status(200).json(user);
    } catch (error) {
      next(error);
    }
  },
  create: async (req, res, next) => {
    try {
      const newUser = await UserService.create(req.body);
      res.status(201).json(newUser);
    } catch (error) {
      next(error);
    }
  },
  update: async (req, res, next) => {
    try {
      const updatedUser = await UserService.update(req.params.id, req.body);
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }
      res.status(200).json(updatedUser);
    } catch (error) {
      next(error);
    }
  },
  delete: async (req, res, next) => {
    try {
      const deletedUser = await UserService.delete(req.params.id);
      if (!deletedUser) {
        return res.status(404).json({ error: "User not found" });
      }
      res.status(200).json({ message: "User deleted successfully" });
    } catch (error) {
      next(error);
    }
  },
  updateSavings: async (req, res, next) => {
    try {
      const { amount } = req.body;
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
