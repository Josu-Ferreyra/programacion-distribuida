import { USERS } from "../mocks/users.js";

function validateExpectedFields(body) {
  const allowedFields = [
    "name",
    "lastName",
    "age",
    "profession",
    "nativeLanguage",
    "country",
    "yearsOfExperience",
  ];

  const unexpectedFields = Object.keys(body).filter(
    (field) => !allowedFields.includes(field),
  );

  if (unexpectedFields.length > 0) {
    throw new Error(`Unexpected fields: ${unexpectedFields.join(", ")}`);
  }
}

function validateRequiredFields(body) {
  // Validate required fields
  if (!body.name) throw new Error("Name is required");
  if (!body.lastName) throw new Error("Last name is required");
  if (!body.age) throw new Error("Age is required");
  if (!body.profession) throw new Error("Profession is required");
  if (!body.nativeLanguage) throw new Error("Native language is required");
  if (!body.country) throw new Error("Country is required");
  if (!body.yearsOfExperience)
    throw new Error("Years of experience is required");
}

function validateBodyExists(body) {
  // Validate request body
  if (!body) {
    throw new Error("Request body is missing");
  }
}

function validateId(id) {
  const userId = id;
  const userIndex = USERS.findIndex((user) => user.id === userId);

  if (userIndex === -1) {
    throw new Error("User not found");
  }

  return userIndex;
}

export {
  validateBodyExists,
  validateExpectedFields,
  validateRequiredFields,
  validateId,
};
