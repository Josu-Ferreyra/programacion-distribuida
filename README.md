# TP4 - Consenso distribuido con Raft

API REST de usuarios y ahorros (TP3) replicada sobre un **cluster fijo de tres nodos** mediante una implementación educativa de **Raft**: elección de Leader por mayoría, heartbeats y failover, log replicado con commit por quorum, State Machine sobre MongoDB, recuperación de followers atrasados y persistencia del estado del protocolo.

Se conservan HTTPS, MongoDB/Mongoose, Winston, Swagger/OpenAPI y la configuración por variables de entorno. Redis se conserva **sólo** para el lock distribuido del TP2.

## Requisitos previos

- Node.js 20 o superior (usa `fetch` nativo)
- MongoDB (una instancia local alcanza: cada nodo usa su propia base)
- Redis o Memurai (compartido por los tres nodos, sólo para el lock de ahorros)
- OpenSSL para generar el certificado local

## Instalación

1. Instalar dependencias:

```bash
npm install
```

2. Generar los certificados HTTPS en `certs/` (no se versionan):

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/key.pem \
  -out certs/cert.pem \
  -days 365 \
  -subj "/CN=localhost"
```

3. Crear el `.env` a partir del ejemplo y ajustar si hace falta:

```bash
cp .env.example .env
```

4. Levantar MongoDB y Redis:

```bash
sudo systemctl start mongodb
sudo systemctl start redis
```

## Topología del cluster

La identidad se elige al iniciar el proceso (`node server.js <nodeId>`). A partir de ella se derivan los puertos, la base y la lista de peers ([config/cluster.js](config/cluster.js)). No hay que editar código entre ejecuciones.

| Nodo  | API externa (HTTPS)      | RPC Raft interno (HTTP)  | Base MongoDB |
|-------|--------------------------|--------------------------|--------------|
| node1 | `https://localhost:3001` | `http://127.0.0.1:4001`  | `tp4_node1`  |
| node2 | `https://localhost:3002` | `http://127.0.0.1:4002`  | `tp4_node2`  |
| node3 | `https://localhost:3003` | `http://127.0.0.1:4003`  | `tp4_node3`  |

Cada base contiene las colecciones `users` (estado de negocio), `raft_log` (log replicado) y `raft_state` (término, voto, commitIndex, lastApplied).

## Ejecución

**Opción recomendada para las pruebas: una terminal por nodo**, así se puede detener y reiniciar cada uno por separado (Ctrl+C o `kill -9 <pid>`):

```bash
npm run node1
npm run node2
npm run node3
```

Opción rápida, los tres en una sola terminal (Ctrl+C detiene los tres):

```bash
npm run start:cluster
```

Estado del cluster (rol, término, Leader, índices, cantidad y hash de usuarios de cada base para comprobar convergencia):

```bash
npm run status
npm run status -- --log   # incluye el log de cada nodo y el estado de cada entrada
```

Swagger UI de cada nodo: `https://localhost:3001/api-docs` (3002, 3003).

## Endpoints

### API de negocio (HTTPS, puerto 300X)

| Método | Ruta                          | Consenso                              |
|--------|-------------------------------|---------------------------------------|
| GET    | `/api/users`                  | Lectura local                         |
| GET    | `/api/users/:id`              | Lectura local                         |
| POST   | `/api/users`                  | Raft (sólo Leader)                    |
| PUT    | `/api/users/:id`              | Raft (sólo Leader)                    |
| DELETE | `/api/users/:id`              | Raft (sólo Leader)                    |
| POST   | `/api/users/:id/savings`      | Lock Redis + Raft (sólo Leader)       |

Las escrituras confirmadas devuelven los headers `X-Raft-Node`, `X-Raft-Index` y `X-Raft-Term` con la entrada del log que las confirmó.

### Diagnóstico (HTTPS, sólo lectura)

- `GET /api/raft/status`: identidad, `pid`, rol, término, voto, Leader conocido, `lastLogIndex`, `commitIndex`, `lastApplied`, election timeout actual y, en el Leader, `nextIndex`/`matchIndex` de cada follower.
- `GET /api/raft/log?from=1&limit=100`: entradas del log local con su estado:
  - `LOCAL`: sólo en el log del Leader.
  - `REPLICATED`: el Leader sabe que está en algún follower, sin mayoría todavía.
  - `UNCOMMITTED`: en el log de un follower, sin confirmar.
  - `COMMITTED`: confirmada por mayoría, pendiente de aplicar.
  - `APPLIED`: confirmada y aplicada en la State Machine local.

  En el Leader cada entrada incluye `replicatedOn` (nodos que la tienen).

### RPC internos del protocolo (HTTP, puerto 400X)

- `POST /raft/request-vote`
- `POST /raft/append-entries` (con `entries: []` funciona como heartbeat)

Viven en un servidor separado de la API de negocio, escuchando sólo en `127.0.0.1`. Están documentados en Swagger (tag "Raft RPC interno") como referencia, pero **no** deben usarse como mecanismo de prueba de negocio.

## Decisiones de diseño

### Flujo de una escritura

```
Cliente -> API del Leader -> validación -> comando -> log Raft local (LOCAL)
        -> AppendEntries a followers -> mayoría (COMMITTED)
        -> State Machine de cada nodo -> MongoDB local (APPLIED)
        -> respuesta al cliente
```

- **MongoDB nunca se modifica antes del consenso.** El único código que escribe en la colección `users` es la State Machine ([raft/state-machine.js](raft/state-machine.js)), y sólo procesa entradas committed en orden de índice (`lastApplied` evita saltos y desorden).
- **Comandos completos y determinísticos.** El Leader genera una sola vez el `_id` (ObjectId) y el `timestamp` y los guarda en el comando (`CREATE_USER`, `UPDATE_USER`, `DELETE_USER`, `SET_SAVINGS`). Así todas las réplicas guardan exactamente el mismo documento. El campo `version` de cada usuario es el índice del log que produjo su última modificación, igual en las tres bases.
- **Aplicación idempotente.** Si un nodo cae entre aplicar una entrada y persistir `lastApplied`, al reiniciar la vuelve a aplicar. Por eso la creación tolera el `_id` duplicado y el ahorro se replica como valor absoluto (`SET_SAVINGS`), no como incremento.
- **Errores de negocio determinísticos.** Si un comando falla por validación o porque el recurso no existe, falla igual en todas las réplicas y `lastApplied` avanza igual.
- **Entrada NOOP al asumir el liderazgo.** Un Leader sólo puede confirmar por conteo entradas de su propio término (Raft §5.4.2). Con la NOOP inicial confirma también las entradas pendientes de términos anteriores.

### Escritura recibida por un follower: rechazo informando el Leader

La alternativa elegida es el **rechazo** ([middlewares/require-leader.js](middlewares/require-leader.js)). El follower no aplica ni propone nada y responde:

- `421 Misdirected Request` con `leaderId` y `leaderUrl` en el cuerpo y el header `X-Raft-Leader` cuando conoce al Leader.
- `503 Service Unavailable` con `Retry-After` cuando no hay Leader conocido (elección en curso o sin quorum).

El cliente reenvía la petición a `leaderUrl`. Se eligió el rechazo en vez de un proxy para que quede explícito quién coordina y para no ocultar fallas del Leader detrás de un reenvío.

### Escritura sin quorum

Si el Leader no logra mayoría dentro de `RAFT_COMMIT_TIMEOUT_MS`, responde `503` con `committed: false`. La entrada queda `LOCAL` en su log y **no** se aplica. El 503 significa "no confirmada todavía", no "descartada":

- Si ese mismo Leader recupera la mayoría, la entrada se replica y se confirma (se observa en el escenario G).
- Si otro nodo gana una elección, la entrada se trunca al reincorporarse el viejo Leader (log "Conflicto con el log del Leader: se truncan entradas no confirmadas").

### Persistencia del estado Raft (Hito 6)

| Dato                     | ¿Persistido? | Motivo |
|--------------------------|--------------|--------|
| `currentTerm`            | Sí | El término nunca debe retroceder tras un reinicio. |
| `votedFor`               | Sí | Sin él, un nodo reiniciado podría votar dos veces en el mismo término y permitir dos Leaders. |
| log (`raft_log`)         | Sí | Una entrada contada para la mayoría no puede desaparecer. |
| `commitIndex`            | Sí (opcional en Raft) | Permite aplicar al arrancar sin esperar al Leader. |
| `lastApplied`            | Sí (opcional en Raft) | Indica dónde retomar la State Machine, que también es persistente (MongoDB). |
| rol, Leader conocido, `nextIndex`/`matchIndex`, timers | No | Se reconstruyen: todo nodo arranca como FOLLOWER y el Leader reinicializa el progreso de cada follower. |

El término, el voto y el log se escriben con `writeConcern { j: true }` y **antes** de responder el RPC correspondiente.

### Recuperación de followers atrasados

El Leader guarda por follower `nextIndex` (desde dónde enviar) y `matchIndex` (hasta dónde sabe que coincide). Si el follower rechaza un AppendEntries porque no puede enlazar la entrada previa (`prevLogIndex`/`prevLogTerm`), el Leader retrocede `nextIndex` y reintenta de inmediato hasta encontrar el punto común. Después envía las entradas faltantes en lotes (`RAFT_MAX_ENTRIES_PER_RPC`). La respuesta del follower incluye `matchHint` (su último índice posible), lo que evita retroceder de a uno cuando simplemente le faltan entradas.

### Redis + Raft (actividad 6.1)

`POST /api/users/:id/savings`:

1. El Leader toma el lock `lock:users:<id>:savings` en Redis (`SET NX PX`). Si ya está tomado, responde `409`.
2. Lee el saldo local (después de asegurarse de haber aplicado todo lo confirmado en términos anteriores) y calcula el nuevo valor.
3. Propone `SET_SAVINGS` a Raft y espera a que la entrada quede committed y aplicada.
4. Libera el lock (script Lua que verifica el dueño).

Redis decide **quién** entra a la sección crítica. Raft decide **cómo** se ordena, replica y confirma la modificación aceptada. Redis no participa en elecciones, votos, quorum ni commit: si Redis está caído, el cluster Raft funciona igual y sólo este endpoint responde `503`. `SAVINGS_CRITICAL_SECTION_DELAY_MS` agrega un retardo dentro de la sección crítica para que la exclusión mutua sea observable.

## Estructura

```
server.js                 arranque de un nodo (identidad por argumento)
config/cluster.js         configuración común del cluster y tiempos Raft
raft/raft-node.js         núcleo Raft: roles, elección, heartbeats, replicación, commit, apply
raft/raft-storage.js      persistencia de term/voto/log/commitIndex/lastApplied
raft/state-machine.js     aplicación de comandos committed sobre MongoDB
raft/rpc-server.js        servidor HTTP interno (RequestVote / AppendEntries)
raft/rpc-client.js        cliente HTTP de los RPC
raft/errors.js            NotLeader / CommitTimeout / LeadershipLost
middlewares/require-leader.js   política de escrituras en followers
services/user.service.js  validación + creación de comandos + lock Redis
scripts/cluster.js        lanza los tres nodos
scripts/status.js         estado y convergencia del cluster
scripts/e2e.js            recorre automáticamente los escenarios A-I
```

## Observabilidad

Cada nodo escribe `logs/<nodeId>-combined.log` y `logs/<nodeId>-error.log` (JSON) y muestra en consola `[nodeId]` en cada línea. Eventos registrados:

- Elección: timeout vencido, voto concedido/denegado y motivo, voto recibido, mayoría alcanzada.
- Término y liderazgo: cambio de término, cambio de rol, Leader reconocido.
- Heartbeats: enviados y recibidos, en nivel `debug` (`LOG_LEVEL=debug`). La detención de heartbeats al dejar de ser Leader se registra en `warn`.
- Replicación: entrada agregada al log local, entradas replicadas en cada follower, rechazo por inconsistencia y retroceso de `nextIndex`, truncado por conflicto.
- Commit y aplicación: commit por mayoría con las réplicas que la forman, avance de commitIndex en followers, entrada aplicada a la State Machine.
- Peers: accesible / no responde (sólo en las transiciones).

## Secuencia de pruebas

### Automática

`scripts/e2e.js` lanza y detiene los nodos y recorre los escenarios A-I sin modificar código entre pruebas, usando sólo la API externa. Antes de correrlo, detener el cluster si está levantado.

```bash
npm run e2e -- --reset | tee evidencias/pruebas-finales.txt
```

`--reset` borra las tres bases antes de empezar. Sin el flag usa los datos existentes.

### Manual

Con un nodo por terminal. `curl -k` acepta el certificado autofirmado. En los ejemplos `$L` es la URL del Leader actual y `$F` la de un follower (ver `npm run status`).

```bash
USER='{"name":"Ana","lastName":"Gómez","age":30,"profession":"Dev","nativeLanguage":"Spanish","country":"Argentina"}'
```

| Escenario | Pasos | Qué observar |
|-----------|-------|--------------|
| **A** Arranque | Iniciar node1, node2, node3. `npm run status` | Un LEADER y dos FOLLOWER con el mismo término y Leader. En los logs, "Election timeout vencido", "Voto concedido", "mayoría alcanzada". |
| **B** Escritura en follower | `curl -ki -X POST $F/api/users -H 'Content-Type: application/json' -d "$USER"` | `421` con `leaderUrl`. `npm run status`: ningún log ni base cambió. |
| **C** CRUD en Leader | POST, `PUT $L/api/users/<id>` con `{"age":31}`, `DELETE $L/api/users/<id>` | `npm run status`: mismo `lastApplied` y mismo `usersHash` en los tres. `GET /api/users/<id>` en cada nodo: mismo `_id` y `version`. |
| **D** Caída del Leader | `kill -9 <pid del leader>` (pid en `status`) | Los followers dejan de recibir heartbeats, vence el timeout y uno es elegido con término mayor. |
| **E** Quorum 2/3 | POST en el nuevo Leader | `201`. En `GET /api/raft/log`, la entrada aparece `APPLIED` con `replicatedOn` de dos nodos. |
| **F** Sin quorum 1/3 | Detener otro nodo y hacer POST en el que queda | Si queda el Leader: `503`, `committed:false`, entrada `LOCAL` y no aplicada. Si queda un follower: `503` sin Leader conocido, y el nodo reintenta elecciones sin éxito. |
| **G** Follower atrasado | Reiniciar los nodos detenidos | Logs: "Log atrasado respecto del Leader", "rechazó AppendEntries por inconsistencia: se retrocede nextIndex", "Entradas replicadas". `status`: mismo log y hash en los tres. |
| **H** Restart completo | `npm run status` y guardar la salida. Detener los tres, reiniciarlos sin borrar las bases y esperar la elección | Al arrancar, "Estado Raft recuperado" con term/voto/log previos. Nueva elección con término mayor. Mismo `usersHash` que antes. |
| **I** Redis + Raft | Lanzar dos depósitos casi simultáneos (ver abajo) | Uno `200` (con `X-Raft-Index`) y el otro `409`. El saldo final converge en los tres nodos. |

```bash
# Escenario I
curl -sk -X POST $L/api/users/<id>/savings -H 'Content-Type: application/json' -d '{"amount":100}' &
curl -sk -X POST $L/api/users/<id>/savings -H 'Content-Type: application/json' -d '{"amount":200}' &
wait
```

### Comandos útiles para validar los locks en Redis

```
EXISTS lock:users:<ID_DEL_USUARIO>:savings
PTTL lock:users:<ID_DEL_USUARIO>:savings
GET lock:users:<ID_DEL_USUARIO>:savings
```

## Correspondencia con los hitos

| Hito | Implementación |
|------|----------------|
| 1 Cluster e identidad | `config/cluster.js`, `server.js <nodeId>`, bases `tp4_nodeX`, `GET /api/raft/status` |
| 2 Elección y quorum | `raft-node.js`: `#startElection`, `handleRequestVote`, `#becomeLeader`, `quorum = floor(n/2)+1`, timeout aleatorio |
| 3 Heartbeats y failover | `#broadcastAppendEntries` periódico, `#resetElectionTimer` sólo ante un Leader válido, `#stepDown` detiene heartbeats |
| 4 Log y commit | `propose`, `#sendAppendEntries`, verificación `prevLogIndex/prevLogTerm`, `nextIndex/matchIndex`, `#advanceCommitIndex` |
| 5 State Machine y API | `raft/state-machine.js`, `services/user.service.js`, `middlewares/require-leader.js` |
| 6 Recuperación y persistencia | retroceso de `nextIndex` + `matchHint`, truncado por conflicto, `raft/raft-storage.js` |
| 6.1 Redis + Raft | `UserService.updateSavings` |

Las respuestas a las preguntas de control y la comparación con Paxos están en [RESPUESTAS.md](RESPUESTAS.md). Las evidencias de ejecución están en [evidencias/](evidencias/).
