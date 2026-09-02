import mongoose from "mongoose";

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
  },
  {
    timestamps: true,
  },
);

export const User = mongoose.model("User", userSchema);
