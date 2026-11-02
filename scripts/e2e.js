// Recorre automáticamente los escenarios A-I de las pruebas finales sin
// modificar el código entre pruebas. Lanza y detiene los nodos como procesos
// independientes y sólo usa la API externa (negocio + diagnóstico de lectura).
//
//   npm run e2e                -> usa las bases existentes
//   npm run e2e -- --reset     -> borra antes las bases de los tres nodos
//
// La salida está pensada para guardarse como evidencia:
//   npm run e2e -- --reset | tee evidencias/pruebas-finales.txt
import "dotenv/config";
import { spawn } from "child_process";
import crypto from "crypto";
import mongoose from "mongoose";
import { getClusterNodes } from "../config/cluster.js";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // certificado autofirmado local
process.removeAllListeners("warning");
process.env.SAVINGS_CRITICAL_SECTION_DELAY_MS ??= "1000";

const NODES = Object.fromEntries(getClusterNodes().map((node) => [node.id, node]));
const processes = {};
let failures = 0;

// ------------------------------------------------------------------ helpers

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString().slice(11, 23);

function section(title) {
  console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`);
}
function info(message) {
  console.log(`[${now()}] ${message}`);
}
function check(condition, message) {
  console.log(`  ${condition ? "OK  " : "FAIL"} ${message}`);
  if (!condition) failures++;
  return condition;
}

async function api(nodeId, method, path, body) {
  const response = await fetch(`${NODES[nodeId].apiUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: Object.fromEntries(
      [...response.headers].filter(([key]) => key.startsWith("x-raft") || key === "retry-after"),
    ),
    body: text ? JSON.parse(text) : null,
  };
}

async function tryStatus(nodeId) {
  try {
    return (await api(nodeId, "GET", "/api/raft/status")).body;
  } catch {
    return null;
  }
}

async function waitFor(description, predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(200);
  }
  throw new Error(`Timeout esperando: ${description}`);
}

function startNode(nodeId) {
  processes[nodeId] = spawn(process.execPath, ["server.js", nodeId], {
    stdio: "ignore",
    env: process.env,
  });
  info(`Iniciado ${nodeId} (pid ${processes[nodeId].pid})`);
  return waitFor(`${nodeId} disponible`, () => tryStatus(nodeId));
}

async function stopNode(nodeId, signal = "SIGKILL") {
  const child = processes[nodeId];
  if (!child) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill(signal);
  await exited;
  delete processes[nodeId];
  info(`Detenido ${nodeId} con ${signal}`);
}

const alive = () => Object.keys(processes);

async function clusterSnapshot(nodeIds = Object.keys(NODES)) {
  const rows = {};
  for (const nodeId of nodeIds) {
    const status = processes[nodeId] ? await tryStatus(nodeId) : null;
    if (!status) {
      rows[nodeId] = { role: "DOWN" };
      continue;
    }
    const users = (await api(nodeId, "GET", "/api/users")).body;
    rows[nodeId] = {
      role: status.role,
      term: status.currentTerm,
      leader: status.leaderId,
      lastLogIndex: status.lastLogIndex,
      commitIndex: status.commitIndex,
      lastApplied: status.lastApplied,
      users: users.length,
      usersHash: hashUsers(users),
    };
  }
  return rows;
}

function hashUsers(users) {
  const sorted = [...users].sort((a, b) => a._id.localeCompare(b._id));
  return crypto.createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 12);
}

async function printCluster() {
  console.table(await clusterSnapshot());
}

// Exactamente un Leader entre los vivos y todos de acuerdo en quién es.
async function waitForLeader(nodeIds = alive(), { minTerm = 0 } = {}) {
  return waitFor("Leader elegido", async () => {
    const statuses = (await Promise.all(nodeIds.map(tryStatus))).filter(Boolean);
    const leaders = statuses.filter((s) => s.role === "LEADER" && s.currentTerm >= minTerm);
    if (leaders.length !== 1) return null;
    const [leader] = leaders;
    const agree = statuses.every(
      (s) => s.leaderId === leader.nodeId && s.currentTerm === leader.currentTerm,
    );
    return agree && statuses.length === nodeIds.length ? leader : null;
  });
}

// Mismos usuarios (hash) y mismo lastApplied en los nodos indicados.
async function waitForConvergence(nodeIds = alive()) {
  return waitFor(
    `convergencia de ${nodeIds.join(", ")}`,
    async () => {
      const snapshot = await clusterSnapshot(nodeIds);
      const rows = Object.values(snapshot);
      const sameHash = new Set(rows.map((r) => r.usersHash)).size === 1;
      const sameApplied = new Set(rows.map((r) => r.lastApplied)).size === 1;
      return sameHash && sameApplied ? snapshot : null;
    },
    20000,
  );
}

async function getLogEntry(nodeId, index) {
  const log = (await api(nodeId, "GET", `/api/raft/log?from=${index}&limit=1`)).body;
  return log.entries[0];
}

const sampleUser = (name) => ({
  name,
  lastName: "Prueba",
  age: 30,
  profession: "QA",
  nativeLanguage: "Spanish",
  country: "Argentina",
  yearsOfExperience: 3,
});

async function resetDatabases() {
  for (const node of Object.values(NODES)) {
    const connection = await mongoose.createConnection(node.mongoUri).asPromise();
    await connection.dropDatabase();
    await connection.close();
    info(`Base de ${node.id} eliminada (${node.mongoUri})`);
  }
}

// ------------------------------------------------------------------ escenarios

async function run() {
  for (const nodeId of Object.keys(NODES)) {
    if (await tryStatus(nodeId)) {
      throw new Error(`${nodeId} ya está corriendo: detené el cluster antes de ejecutar e2e`);
    }
  }
  if (process.argv.includes("--reset")) await resetDatabases();

  // ---------------------------------------------------------------- A
  section("A - Arranque de tres nodos: se identifica un Leader y dos followers");
  await Promise.all(Object.keys(NODES).map(startNode));
  let leader = await waitForLeader();
  await printCluster();
  const followersA = alive().filter((id) => id !== leader.nodeId);
  check(true, `Leader: ${leader.nodeId} (term ${leader.currentTerm}); followers: ${followersA.join(", ")}`);

  // ---------------------------------------------------------------- B
  section("B - Escritura sobre follower: no se aplica localmente saltándose el consenso");
  const follower = followersA[0];
  const before = await clusterSnapshot();
  const rejected = await api(follower, "POST", "/api/users", sampleUser("EnviadoAFollower"));
  console.log(`  POST ${NODES[follower].apiUrl}/api/users ->`, rejected.status, rejected.headers, rejected.body);
  const after = await clusterSnapshot();
  check(rejected.status === 421, `${follower} responde 421 Misdirected Request`);
  check(rejected.body.leaderUrl === NODES[leader.nodeId].apiUrl, `informa el Leader (${rejected.body.leaderUrl})`);
  check(
    Object.keys(NODES).every(
      (id) => after[id].users === before[id].users && after[id].lastLogIndex === before[id].lastLogIndex,
    ),
    "ningún nodo cambió su log ni su base",
  );

  // ---------------------------------------------------------------- C
  section("C - CRUD sobre Leader: las operaciones confirmadas convergen en los tres nodos");
  const created = await api(leader.nodeId, "POST", "/api/users", sampleUser("Ana"));
  console.log("  POST ->", created.status, created.headers);
  check(created.status === 201, `usuario creado con _id ${created.body._id}`);
  const userId = created.body._id;

  await waitForConvergence();
  for (const nodeId of alive()) {
    const user = (await api(nodeId, "GET", `/api/users/${userId}`)).body;
    check(user._id === userId && user.version === created.body.version,
      `${nodeId}: mismo _id ${user._id} y version ${user.version}`);
  }

  const updated = await api(leader.nodeId, "PUT", `/api/users/${userId}`, { age: 31, profession: "Dev" });
  console.log("  PUT  ->", updated.status, updated.headers);
  await waitForConvergence();
  for (const nodeId of alive()) {
    const user = (await api(nodeId, "GET", `/api/users/${userId}`)).body;
    check(user.age === 31 && user.version === updated.body.version,
      `${nodeId}: age=${user.age}, version=${user.version}, updatedAt=${user.updatedAt}`);
  }

  const toDelete = await api(leader.nodeId, "POST", "/api/users", sampleUser("ParaBorrar"));
  const deleted = await api(leader.nodeId, "DELETE", `/api/users/${toDelete.body._id}`);
  console.log("  DELETE ->", deleted.status, deleted.headers);
  await waitForConvergence();
  for (const nodeId of alive()) {
    const response = await api(nodeId, "GET", `/api/users/${toDelete.body._id}`);
    check(response.status === 404, `${nodeId}: usuario eliminado (GET -> 404)`);
  }
  console.table(await waitForConvergence());

  // ---------------------------------------------------------------- D
  section("D - Caída del Leader: los nodos restantes realizan una nueva elección");
  const oldLeader = leader.nodeId;
  const oldTerm = leader.currentTerm;
  await stopNode(oldLeader, "SIGKILL");
  const t0 = Date.now();
  leader = await waitForLeader(alive(), { minTerm: oldTerm + 1 });
  info(`Nuevo Leader ${leader.nodeId} en ${Date.now() - t0} ms`);
  await printCluster();
  check(leader.nodeId !== oldLeader && leader.currentTerm > oldTerm,
    `nuevo Leader ${leader.nodeId} con término ${leader.currentTerm} > ${oldTerm}`);

  // ---------------------------------------------------------------- E
  section("E - Quorum 2/3: el cluster puede confirmar nuevas operaciones");
  const withQuorum = await api(leader.nodeId, "POST", "/api/users", sampleUser("ConQuorum"));
  console.log("  POST ->", withQuorum.status, withQuorum.headers);
  check(withQuorum.status === 201, "escritura confirmada con Leader + 1 follower");
  const entryE = await getLogEntry(leader.nodeId, Number(withQuorum.headers["x-raft-index"]));
  console.log("  entrada en el log del Leader:", entryE);
  check(entryE.state === "APPLIED" && entryE.replicatedOn.length === 2,
    `entrada ${entryE.index} replicada en ${entryE.replicatedOn.join(", ")} y aplicada`);
  await waitForConvergence();

  // ---------------------------------------------------------------- F
  section("F - Sin quorum 1/3: no se confirman nuevas escrituras");
  const lastFollower = alive().find((id) => id !== leader.nodeId);
  await stopNode(lastFollower, "SIGKILL");
  const usersBeforeF = (await api(leader.nodeId, "GET", "/api/users")).body.length;
  const noQuorum = await api(leader.nodeId, "POST", "/api/users", sampleUser("SinQuorum"));
  console.log("  POST ->", noQuorum.status, noQuorum.body);
  check(noQuorum.status === 503 && noQuorum.body.committed === false, "la escritura NO se confirma (503)");
  const entryF = await getLogEntry(leader.nodeId, noQuorum.body.index);
  console.log("  entrada en el log del Leader:", entryF);
  check(entryF.state === "LOCAL", `entrada ${entryF.index} sólo en el log local del Leader (state=LOCAL)`);
  const usersAfterF = (await api(leader.nodeId, "GET", "/api/users")).body.length;
  check(usersAfterF === usersBeforeF, "la State Machine no la aplicó (misma cantidad de usuarios)");
  await printCluster();

  // ---------------------------------------------------------------- G
  section("G - Follower atrasado: al regresar recupera las entradas faltantes");
  const behind = oldLeader; // estuvo caído durante E y F
  await startNode(behind);
  const behindStatus = await tryStatus(behind);
  info(`${behind} reinicia con lastLogIndex=${behindStatus.lastLogIndex}, Leader tiene ${(await tryStatus(leader.nodeId)).lastLogIndex}`);
  await waitForConvergence([leader.nodeId, behind]);
  const entryFLater = await getLogEntry(leader.nodeId, entryF.index);
  check(entryFLater.state === "APPLIED",
    `con la mayoría recuperada, la entrada ${entryF.index} (antes LOCAL) se replica y confirma: ` +
      "el 503 de F significaba 'no confirmada todavía', no 'descartada'");
  await startNode(lastFollower);
  const converged = await waitForConvergence();
  console.table(converged);
  check(new Set(Object.values(converged).map((r) => r.lastLogIndex)).size === 1,
    "los tres nodos tienen el mismo log y el mismo estado de negocio");

  // Variante: el follower atrasado vuelve frente a un Leader RECIÉN elegido,
  // que inicializa nextIndex de forma optimista (su último índice + 1). El
  // follower rechaza por falta de continuidad y el Leader retrocede y reintenta.
  info("Variante G2: follower atrasado frente a un Leader recién elegido");
  leader = await waitForLeader();
  const [lagging, survivor] = alive().filter((id) => id !== leader.nodeId);
  await stopNode(lagging, "SIGKILL");
  for (const name of ["Atrasado1", "Atrasado2"]) {
    const response = await api(leader.nodeId, "POST", "/api/users", sampleUser(name));
    check(response.status === 201, `confirmada ${name} (index ${response.headers["x-raft-index"]}) sin ${lagging}`);
  }
  await waitForConvergence([leader.nodeId, survivor]);
  const previousLeader = leader.nodeId;
  await stopNode(previousLeader, "SIGKILL");
  await startNode(lagging);
  leader = await waitForLeader([lagging, survivor]);
  check(leader.nodeId === survivor,
    `sólo ${survivor} puede ganar: ${lagging} tiene un log desactualizado (restricción de elección)`);
  await waitForConvergence([lagging, survivor]);
  check(true, `${lagging} recuperó las entradas faltantes (ver "rechazó AppendEntries por inconsistencia" en eventos-raft.log)`);
  await startNode(previousLeader);
  console.table(await waitForConvergence());

  // ---------------------------------------------------------------- H
  section("H - Restart completo: se recuperan estado crítico y entradas confirmadas");
  const beforeRestart = await clusterSnapshot();
  console.table(beforeRestart);
  const maxTermBefore = Math.max(...Object.values(beforeRestart).map((r) => r.term));
  await Promise.all(alive().map((id) => stopNode(id, "SIGTERM")));
  info("Los tres procesos detenidos. Reiniciando sin borrar las bases...");
  const startupStatus = await Promise.all(Object.keys(NODES).map(startNode));
  for (const status of startupStatus) {
    check(status.currentTerm >= beforeRestart[status.nodeId].term &&
      status.lastLogIndex === beforeRestart[status.nodeId].lastLogIndex &&
      status.lastApplied === beforeRestart[status.nodeId].lastApplied,
      `${status.nodeId} al arrancar: term=${status.currentTerm}, votedFor=${status.votedFor}, lastLogIndex=${status.lastLogIndex}, lastApplied=${status.lastApplied}`);
  }
  leader = await waitForLeader();
  const afterRestart = await waitForConvergence();
  console.table(afterRestart);
  check(leader.currentTerm > maxTermBefore, `nueva elección: término ${leader.currentTerm} > ${maxTermBefore} (no retrocede)`);
  check(Object.keys(NODES).every((id) => afterRestart[id].usersHash === beforeRestart[id].usersHash),
    "el estado de negocio confirmado sigue disponible (mismo hash de usuarios)");

  // ---------------------------------------------------------------- I
  section("I - Integración Redis + Raft: exclusión mutua y modificación confirmada");
  const saver = (await api(leader.nodeId, "POST", "/api/users", sampleUser("Ahorrista"))).body;
  info(`Dos depósitos concurrentes sobre ${saver._id} (sección crítica de ${process.env.SAVINGS_CRITICAL_SECTION_DELAY_MS} ms)`);
  const [first, second] = await Promise.all([
    api(leader.nodeId, "POST", `/api/users/${saver._id}/savings`, { amount: 100 }),
    sleep(50).then(() => api(leader.nodeId, "POST", `/api/users/${saver._id}/savings`, { amount: 200 })),
  ]);
  console.log("  depósito +100 ->", first.status, first.headers, first.body);
  console.log("  depósito +200 ->", second.status, second.headers, second.body);
  check(first.status === 200 && second.status === 409,
    "una operación obtiene el lock y se confirma; la concurrente es rechazada (409)");
  const third = await api(leader.nodeId, "POST", `/api/users/${saver._id}/savings`, { amount: 200 });
  console.log("  depósito +200 (tras liberar el lock) ->", third.status, third.headers, third.body);
  check(third.status === 200 && third.body.savings === 300, "liberado el lock, la siguiente lee el saldo confirmado (300)");
  await waitForConvergence();
  for (const nodeId of alive()) {
    const user = (await api(nodeId, "GET", `/api/users/${saver._id}`)).body;
    check(user.savings === 300, `${nodeId}: savings=${user.savings}, version=${user.version}`);
  }
}

// ------------------------------------------------------------------ main

try {
  await run();
} catch (error) {
  failures++;
  console.error(`\nERROR: ${error.message}`);
} finally {
  await Promise.all(alive().map((id) => stopNode(id, "SIGTERM")));
  section(failures === 0 ? "RESULTADO: todos los escenarios OK" : `RESULTADO: ${failures} verificación(es) fallida(s)`);
  process.exit(failures === 0 ? 0 : 1);
}
