import express from "express";
import {
  validateBodyExists,
  validateExpectedFields,
  validateId,
  validateRequiredFields,
} from "./utils/validations.js";
import { USERS } from "./mocks/users.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Routes
app.get("/api/users", (req, res) => {
  res.status(200).json(USERS);
});

app.get("/api/users/:id", (req, res) => {
  let userIndex;

  try {
    userIndex = validateId(req.params.id);
  } catch (error) {
    return res.status(404).json({ error: error.message });
  }

  res.status(200).json(USERS[userIndex]);
});

app.post("/api/users", (req, res) => {
  if (!req.body) {
    return res.status(400).json({ error: "Request body is missing" });
  }

  try {
    validateBodyExists(req.body);
    validateRequiredFields(req.body);
    validateExpectedFields(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const newUser = {
    id: crypto.randomUUID(),
    name: req.body.name,
    lastName: req.body.lastName,
    age: req.body.age,
    profession: req.body.profession,
    nativeLanguage: req.body.nativeLanguage,
    country: req.body.country,
    yearsOfExperience: req.body.yearsOfExperience,
  };

  USERS.push(newUser);

  res.status(201).json(newUser);
});

app.put("/api/users/:id", (req, res) => {
  let userIndex;

  try {
    userIndex = validateId(req.params.id);
  } catch (error) {
    return res.status(404).json({ error: error.message });
  }

  try {
    validateBodyExists(req.body);
    validateExpectedFields(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const updatedUser = {
    ...USERS[userIndex],
    ...req.body,
  };

  USERS[userIndex] = updatedUser;

  res.status(200).json(updatedUser);
});

app.delete("/api/users/:id", (req, res) => {
  let userIndex;

  try {
    userIndex = validateId(req.params.id);
  } catch (error) {
    return res.status(404).json({ error: error.message });
  }

  const deletedUser = USERS.splice(userIndex, 1);

  res.status(204).json(deletedUser[0]);
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
