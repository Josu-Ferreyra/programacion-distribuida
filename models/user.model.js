import mongoose from "mongoose";

// Las marcas de tiempo y la versión NO se generan localmente: vienen en el
// comando Raft para que todas las réplicas guarden exactamente el mismo dato.
// `version` es el índice del log que produjo la última modificación.
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    age: { type: Number, required: true, min: 0 },
    profession: { type: String, required: true },
    nativeLanguage: { type: String, required: true },
    country: { type: String, required: true },
    yearsOfExperience: { type: Number, default: 0, min: 0 },
    savings: { type: Number, default: 0, min: 0 },
    version: { type: Number, default: 0 },
    createdAt: { type: Date },
    updatedAt: { type: Date },
  },
  {
    timestamps: false,
    versionKey: false,
  },
);

export const USER_EDITABLE_FIELDS = [
  "name",
  "lastName",
  "age",
  "profession",
  "nativeLanguage",
  "country",
  "yearsOfExperience",
];

export const User = mongoose.model("User", userSchema);
