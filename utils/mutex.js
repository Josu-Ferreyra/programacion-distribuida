// Mutex asíncrono mínimo: serializa secciones que leen/modifican el estado Raft
// y lo persisten (await) para que dos RPC no se intercalen a mitad de camino.
export class Mutex {
  #last = Promise.resolve();

  run(fn) {
    const result = this.#last.then(fn);
    this.#last = result.catch(() => {});
    return result;
  }
}
