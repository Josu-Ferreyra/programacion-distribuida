// Errores que la API traduce a respuestas HTTP (statusCode + details).

export class NotLeaderError extends Error {
  constructor(node) {
    const leaderKnown = Boolean(node.leaderId);
    super(
      leaderKnown
        ? `Este nodo (${node.id}) no es el Leader. Las escrituras deben enviarse al Leader ${node.leaderId}.`
        : `Este nodo (${node.id}) no es el Leader y no hay un Leader conocido (elección en curso o sin quorum). Reintentar más tarde.`,
    );
    this.name = "NotLeaderError";
    this.statusCode = leaderKnown ? 421 : 503;
    this.details = {
      nodeId: node.id,
      role: node.role,
      term: node.currentTerm,
      leaderId: node.leaderId,
      leaderUrl: node.leaderApiUrl,
    };
  }
}

export class CommitTimeoutError extends Error {
  constructor(entry, timeoutMs) {
    super(
      `La entrada ${entry.index} no alcanzó quorum en ${timeoutMs} ms: quedó en el log local del Leader SIN confirmar y no fue aplicada. ` +
        "Podría confirmarse más adelante si se recupera la mayoría.",
    );
    this.name = "CommitTimeoutError";
    this.statusCode = 503;
    this.details = { index: entry.index, term: entry.term, committed: false };
  }
}

export class LeadershipLostError extends Error {
  constructor(entry) {
    super(
      `El nodo dejó de ser Leader antes de confirmar la entrada ${entry.index}. Resultado incierto: consultar el estado antes de reintentar.`,
    );
    this.name = "LeadershipLostError";
    this.statusCode = 503;
    this.details = { index: entry.index, term: entry.term, committed: "unknown" };
  }
}
