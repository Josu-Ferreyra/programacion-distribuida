import swaggerJSDoc from "swagger-jsdoc";

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "API de Usuarios y Ahorros",
      version: "1.0.0",
      description: "API concurrente con Redis, MongoDB y logging con Winston",
    },
    servers: [
      {
        url: "https://localhost:3000",
        description: "Servidor local de desarrollo",
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
      },
    },
  },
  apis: ["./routes/*.js"],
};

export const swaggerDocs = swaggerJSDoc(swaggerOptions);
