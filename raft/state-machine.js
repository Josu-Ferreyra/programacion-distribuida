import { User } from "../models/user.model.js";

export const COMMANDS = {
  NOOP: "NOOP",
  CREATE_USER: "CREATE_USER",
  UPDATE_USER: "UPDATE_USER",
  DELETE_USER: "DELETE_USER",
};

const BUSINESS_ERRORS = new Set(["ValidationError", "CastError"]);

const ok = (data = null) => ({ ok: true, data });
const fail = (status, error) => ({ ok: false, status, error });

// State Machine replicada: es el ÚNICO lugar donde se modifica MongoDB de negocio
// y sólo recibe entradas ya committed, en orden de índice.
//
// Cada comando contiene todo lo no determinístico (id, timestamp) y su
// aplicación es idempotente: aplicar dos veces la misma entrada produce el mismo
// estado.
//
// Los errores de negocio (validación, recurso inexistente) son un resultado
// determinístico: todas las réplicas llegan al mismo resultado y avanzan
// lastApplied. Los errores de infraestructura (MongoDB caído) se propagan y la
// aplicación se reintenta más tarde.
export class UserStateMachine {
  async apply(entry) {
    const { command, index } = entry;

    try {
      switch (command.type) {
        case COMMANDS.NOOP:
          return ok();
        case COMMANDS.CREATE_USER:
          return await this.#createUser(command, index);
        case COMMANDS.UPDATE_USER:
          return await this.#updateUser(command, index);
        case COMMANDS.DELETE_USER:
          return await this.#deleteUser(command);
        default:
          return fail(400, `Comando desconocido: ${command.type}`);
      }
    } catch (error) {
      if (BUSINESS_ERRORS.has(error.name)) {
        return fail(400, error.message);
      }
      throw error;
    }
  }

  async #createUser({ id, data, timestamp }, index) {
    const date = new Date(timestamp);
    try {
      const user = await User.create({
        ...data,
        _id: id,
        savings: 0,
        version: index,
        createdAt: date,
        updatedAt: date,
      });
      return ok(user.toJSON());
    } catch (error) {
      // Reaplicación tras un reinicio: el documento ya existe con ese _id.
      if (error.code === 11000) {
        return ok((await User.findById(id)).toJSON());
      }
      throw error;
    }
  }

  async #updateUser({ id, data, timestamp }, index) {
    const user = await User.findByIdAndUpdate(
      id,
      { $set: { ...data, updatedAt: new Date(timestamp), version: index } },
      { new: true, runValidators: true },
    );
    return user ? ok(user.toJSON()) : fail(404, "User not found");
  }

  async #deleteUser({ id }) {
    const user = await User.findByIdAndDelete(id);
    return user ? ok({ _id: id }) : fail(404, "User not found");
  }
}
