1. ¿Qué diferencia existe entre almacenar un recurso en un arreglo JavaScript y almacenarlo
   en MongoDB?

- Que en MongoDB se puede persistir entre sesiones.

2. ¿Qué función cumplen el Schema y el Model de Mongoose dentro de la aplicación?

- Define la estructura de los datos.

3. ¿Por qué conviene diferenciar un identificador inválido de un identificador válido cuyo
   documento no existe?

- Porque de esa forma el usuario entiende que puede haber copiado mal el id en lugar de asegurarle que ese elemento no existe en la DB.

4. ¿Qué diferencia práctica existe entre registrar un evento como INFO, WARN o ERROR?

- A la hora de debuggear. Es más fácil trackear dónde se produjo el error y su contexto.

5. ¿Qué problema resuelven la rotación y la retención limitada de archivos de log?

- Evitan mantener logs inservibles y hacen que sea más fácil buscar y encontrar logs relevantes.

6. ¿Qué diferencia existe entre OpenAPI y Swagger UI?

- Swagger es la UI y OpenAPI es la documentación en sí de los endpoints.

7. ¿La existencia de documentación Swagger garantiza que la implementación del endpoint sea
   correcta? Justifique.

- No, siempre existe el factor humano que puede no leer la documentación o apretando mal un botón en el teclado.

8. ¿Qué ventaja aporta disponer de un contrato de API documentado y reproducible?

- Que se puede pasar a cualquier dev para que continue con su desarrollo.

9. ¿Qué problema resuelve MongoDB/Mongoose que no resolvía el almacenamiento en
   memoria?

- La persistencia de memoria.

10. ¿Qué responsabilidad cumple cada componente: MongoDB, Redis/Memurai, Winston y
    OpenAPI/Swagger?

- MongoDB: Base de Datos.
- Redis/Memurai: Lock de recursos.
- Winston: Logs.
- OpenAPI/Swagger: Documentación de API.
