# Respuestas - TP4

## Preguntas de control (Hito 2)

1. ¿Por qué un nodo no debería votar por dos candidatos diferentes dentro del mismo término?

- Porque la seguridad de la elección depende de que cada nodo dé **un solo voto por término**. Un Leader necesita la mayoría (2 de 3), y dos mayorías del mismo cluster siempre comparten al menos un nodo. Si ese nodo pudiera votar dos veces, dos candidatos podrían juntar mayoría en el mismo término y habría dos Leaders aceptando escrituras distintas para las mismas posiciones del log. Por eso `votedFor` se persiste antes de responder: aunque el nodo se reinicie, recuerda a quién votó. Cuando dos nodos se postulan a la vez, cada uno se vota a sí mismo y rechaza al otro (log: "Voto denegado ... ya votó por node1 en el término 2"). Nadie llega a mayoría y, gracias al timeout aleatorio, uno se adelanta en el término siguiente y gana.

2. ¿Qué debería ocurrir si un mensaje recibido contiene un término mayor al término local?

- El nodo adopta ese término, borra su voto (`votedFor = null`, porque es un término nuevo), lo persiste y pasa a FOLLOWER si era CANDIDATE o LEADER. Un Leader que ve un término mayor deja de enviar heartbeats y rechaza las propuestas pendientes. Después recién procesa el mensaje: por ejemplo, decide si concede el voto o acepta el AppendEntries. Un término mayor significa que su información quedó vieja. Al revés, un mensaje con término **menor** se rechaza devolviendo el término actual, para que el emisor se actualice.

3. ¿Puede un único nodo de un cluster de tres declarar por sí solo que existe consenso?

- No. El quorum es `floor(3/2) + 1 = 2`. Un nodo aislado no puede distinguir "los otros cayeron" de "yo quedé particionado", y los otros dos podrían estar formando una mayoría y eligiendo otro Leader. Si un solo nodo pudiera confirmar, cada lado de una partición confirmaría operaciones distintas (split brain). Por eso un follower aislado sólo puede postularse una y otra vez sin ganar, y un Leader aislado puede agregar entradas a su log, pero no confirmarlas.

## Hito 4 - ¿Por qué no se confirma una operación con un solo nodo activo?

Con un solo nodo vivo la entrada queda en `LOCAL` (escenario F): está escrita en el log del Leader, pero ninguna mayoría la tiene. Si se considerara confirmada y se aplicara, podría perderse: los otros dos nodos pueden volver, elegir entre ellos un Leader que nunca vio esa entrada (su log está igual de actualizado) y sobrescribir esa posición. Una entrada committed tiene que estar en una mayoría. Así cualquier Leader futuro, que también necesita los votos de una mayoría, comparte al menos un nodo con ella, y la restricción de elección (sólo se vota a un log al menos tan actualizado como el propio) garantiza que la tenga.

En la implementación se ven los dos desenlaces posibles de una entrada `LOCAL`:

- El mismo Leader recupera la mayoría: la entrada se replica y se confirma (escenario G).
- Gana otro nodo: al reincorporarse el viejo Leader se trunca la entrada ("Conflicto con el log del Leader: se truncan entradas no confirmadas").

Por eso el 503 informa "no confirmada", no "descartada".

## Paxos y Raft

| Aspecto | Paxos (Basic / Multi-Paxos) | Raft |
|---------|-----------------------------|------|
| Objetivo | Acordar un valor (Basic). Una secuencia de valores con Multi-Paxos. | Replicar un log ordenado desde el diseño. |
| Roles | Proposer, Acceptor, Learner. Un nodo puede cumplir varios. | Follower, Candidate, Leader. |
| Liderazgo | No es obligatorio. Multi-Paxos elige un proposer distinguido como optimización. | Leader fuerte: es el único que agrega entradas, y los datos sólo van del Leader a los followers. |
| Número de "época" | Número de propuesta (ballot), único y creciente. | Término, con a lo sumo un Leader por término. |
| Fase 1 | *Prepare / Promise*: el proposer pide a una mayoría que prometa no aceptar ballots menores y que informe el valor ya aceptado. | *RequestVote*: el candidato pide votos. La restricción de log reemplaza el "adoptar el valor ya aceptado". |
| Fase 2 | *Accept / Accepted*: se acepta el valor y, con mayoría, queda elegido. | *AppendEntries*: el Leader replica. Con mayoría y entrada del término actual, se confirma. |
| Huecos en el log | Multi-Paxos decide cada posición por separado. Puede haber huecos que hay que completar. | El log nunca tiene huecos: la verificación `prevLogIndex/prevLogTerm` garantiza que si dos logs coinciden en una entrada, coinciden en todas las anteriores. |
| Recuperación de réplicas | No está especificada en el algoritmo básico. Cada implementación la resuelve a su manera. | Especificada: `nextIndex`/`matchIndex`, retroceso y reenvío, truncado de conflictos. |
| Quorum | Mayoría de acceptors. | Mayoría del cluster. |
| Comprensibilidad | Correcto y mínimo, pero difícil de llevar a un sistema completo. | Diseñado para ser entendible y descompuesto en elección, replicación y seguridad. |

En ambos la seguridad descansa en lo mismo: **dos mayorías siempre se intersecan**, así que cualquier decisión nueva "ve" las decisiones ya tomadas. Raft se puede leer como un Multi-Paxos con un Leader estable, en el que la fase 1 se hace una vez por término (la elección) y no por cada valor, y con reglas explícitas de orden y recuperación del log. Esas reglas son las que se implementan en este TP.
