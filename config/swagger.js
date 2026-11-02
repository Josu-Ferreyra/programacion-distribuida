import swaggerJSDoc from "swagger-jsdoc";

const logEntrySchema = {
  type: "object",
  properties: {
    index: { type: "integer", example: 3 },
    term: { type: "integer", example: 2 },
    command: {
      type: "object",
      example: {
        type: "CREATE_USER",
        id: "664c1234567890abcdef1234",
        data: { name: "Martín" },
        timestamp: "2026-11-02T12:00:00.000Z",
      },
    },
  },
};

export function buildSwaggerDocs(nodeConfig) {
  return swaggerJSDoc({
    definition: {
      openapi: "3.0.0",
      info: {
        title: `API de Usuarios y Ahorros - cluster Raft (${nodeConfig.id})`,
        version: "2.0.0",
        description:
          "API de usuarios y ahorros sobre un cluster Raft de 3 nodos. Los endpoints 'Raft diagnóstico' son de sólo lectura; los 'Raft RPC interno' se sirven por HTTP en el puerto interno de cada nodo.",
      },
      servers: [
        {
          url: nodeConfig.apiUrl,
          description: `API HTTPS de ${nodeConfig.id}`,
        },
      ],
      components: {
        schemas: {
          UserInput: {
            type: "object",
            required: [
              "name",
              "lastName",
              "age",
              "profession",
              "nativeLanguage",
              "country",
            ],
            properties: {
              name: { type: "string", example: "Martín" },
              lastName: { type: "string", example: "Pérez" },
              age: { type: "integer", example: 28 },
              profession: { type: "string", example: "Software Engineer" },
              nativeLanguage: { type: "string", example: "Spanish" },
              country: { type: "string", example: "Argentina" },
              yearsOfExperience: { type: "integer", example: 4 },
            },
          },
          User: {
            allOf: [
              { $ref: "#/components/schemas/UserInput" },
              {
                type: "object",
                properties: {
                  _id: { type: "string", example: "664c1234567890abcdef1234" },
                  savings: { type: "number", example: 1500 },
                  createdAt: { type: "string", format: "date-time" },
                  updatedAt: { type: "string", format: "date-time" },
                },
              },
            ],
          },
          ErrorResponse: {
            type: "object",
            properties: {
              error: { type: "string", example: "Mensaje descriptivo del error" },
            },
          },
          RaftStatus: {
            type: "object",
            properties: {
              nodeId: { type: "string", example: "node1" },
              pid: { type: "integer" },
              role: { type: "string", enum: ["FOLLOWER", "CANDIDATE", "LEADER"] },
              currentTerm: { type: "integer" },
              votedFor: { type: "string", nullable: true },
              leaderId: { type: "string", nullable: true },
              leaderUrl: { type: "string", nullable: true },
              clusterSize: { type: "integer", example: 3 },
              quorum: { type: "integer", example: 2 },
              lastLogIndex: { type: "integer" },
              lastLogTerm: { type: "integer" },
              commitIndex: { type: "integer" },
              lastApplied: { type: "integer" },
              electionTimeoutMs: { type: "integer", nullable: true },
              lastHeartbeatAt: { type: "string", nullable: true },
              peers: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    apiUrl: { type: "string" },
                    raftUrl: { type: "string" },
                    reachable: { type: "boolean", description: "Sólo en el Leader" },
                    nextIndex: { type: "integer", description: "Sólo en el Leader" },
                    matchIndex: { type: "integer", description: "Sólo en el Leader" },
                  },
                },
              },
            },
          },
          RaftLog: {
            type: "object",
            properties: {
              nodeId: { type: "string" },
              role: { type: "string" },
              currentTerm: { type: "integer" },
              lastLogIndex: { type: "integer" },
              commitIndex: { type: "integer" },
              lastApplied: { type: "integer" },
              entries: {
                type: "array",
                items: {
                  allOf: [
                    logEntrySchema,
                    {
                      type: "object",
                      properties: {
                        state: {
                          type: "string",
                          enum: ["LOCAL", "REPLICATED", "UNCOMMITTED", "COMMITTED", "APPLIED"],
                        },
                        replicatedOn: {
                          type: "array",
                          items: { type: "string" },
                          description: "Sólo en el Leader",
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          RequestVoteRequest: {
            type: "object",
            properties: {
              term: { type: "integer" },
              candidateId: { type: "string" },
              lastLogIndex: { type: "integer" },
              lastLogTerm: { type: "integer" },
            },
          },
          RequestVoteResponse: {
            type: "object",
            properties: {
              term: { type: "integer" },
              voteGranted: { type: "boolean" },
              reason: { type: "string" },
            },
          },
          AppendEntriesRequest: {
            type: "object",
            properties: {
              term: { type: "integer" },
              leaderId: { type: "string" },
              prevLogIndex: { type: "integer" },
              prevLogTerm: { type: "integer" },
              entries: { type: "array", items: logEntrySchema },
              leaderCommit: { type: "integer" },
            },
          },
          AppendEntriesResponse: {
            type: "object",
            properties: {
              term: { type: "integer" },
              success: { type: "boolean" },
              lastLogIndex: { type: "integer" },
              reason: { type: "string" },
              matchHint: {
                type: "integer",
                description: "En un rechazo, último índice que el follower podría compartir con el Leader",
              },
            },
          },
        },
      },
    },
    apis: ["./routes/*.js", "./raft/rpc-server.js"],
  });
}
